import { openCreationModal, creationDialog, navigateSidebar } from './helpers/ui.js'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await expect(
		page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
	).toBeVisible()
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready
	})
	await page.reload()
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true)
	await expect(
		page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
	).toBeVisible()
	// Update/draft scenarios begin after the local workspace scope has settled.
	await expect(page).toHaveURL(/\/\?workspace=[a-f0-9-]+$/)
})

test('loads an unvisited page and reloads its shell offline', async ({ page, context }) => {
	await page.goto('/accounts')
	await openCreationModal(page, 'Add Account')
	await creationDialog(page, 'Add Account').getByLabel('Account name').fill('Offline checking')
	await creationDialog(page, 'Add Account').getByLabel('Account type').selectOption('bank')
	await creationDialog(page, 'Add Account')
		.getByRole('button', { name: 'Add Account', exact: true })
		.click()
	await expect(creationDialog(page, 'Add Account').getByRole('status')).toContainText(
		'Offline checking'
	)
	await context.setOffline(true)
	const workspaceId = new URL(page.url()).searchParams.get('workspace')
	if (!workspaceId) throw new Error('Expected workspace query parameter')
	const response = await page.goto(`/expenses/new?workspace=${workspaceId}`)
	expect(response?.fromServiceWorker()).toBe(true)
	await expect(page.getByRole('heading', { name: 'Add Expenses' })).toBeVisible()
	await expect(page.getByLabel('Account', { exact: true })).toContainText('Offline checking')
	const reload = await page.reload()
	expect(reload?.fromServiceWorker()).toBe(true)
	await expect(page.getByRole('heading', { name: 'Add Expenses' })).toBeVisible()
	await expect(page.getByLabel('Account', { exact: true })).toContainText('Offline checking')
})

test('caches only same-origin public shells and build assets', async ({ page }) => {
	const paths = await page.evaluate(async () => {
		const names = await caches.keys()
		const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()))
		return requests.flat().map((request) => request.url)
	})
	expect(paths.length).toBeGreaterThan(0)
	for (const path of paths) {
		const url = new URL(path)
		expect(url.origin).toBe(new URL(page.url()).origin)
		expect(url.pathname).toMatch(
			/^\/(?:$|_app\/immutable\/|app-icon\.svg$|favicon\.(?:svg|ico)$|favicon-96x96\.png$|apple-touch-icon\.png$|web-app-manifest-(?:192x192|512x512)\.png$|settings\/(?:categories|tags|workspace|banks)$|robots\.txt$|manifest\.webmanifest$|offline$|accounts$|account$|expenses(?:\/new)?$|income(?:\/new)?$|transfers(?:\/new)?$|login$)/
		)
	}
})

test('a worker update waits without replacing or reloading the open page', async ({ page }) => {
	await page.goto('/accounts')
	await openCreationModal(page, 'Add Account')
	await creationDialog(page, 'Add Account').getByLabel('Account name').fill('Unsaved account')
	const workerPath = '.svelte-kit/output/client/service-worker.js'
	const original = await readFile(workerPath, 'utf8')
	let navigations = 0
	page.on('framenavigated', (frame) => {
		if (frame === page.mainFrame()) navigations += 1
	})
	try {
		// Change only generated output bytes to simulate a deployed worker update.
		await writeFile(workerPath, `${original}\n// Playwright update fixture\n`)
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready
			await registration.update()
		})
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const registration = await navigator.serviceWorker.ready
					return registration.waiting?.state
				})
			)
			.toBe('installed')
		expect(navigations).toBe(0)
		await expect(creationDialog(page, 'Add Account').getByLabel('Account name')).toHaveValue(
			'Unsaved account'
		)
		expect(
			await page.evaluate(async () => {
				const registration = await navigator.serviceWorker.ready
				return navigator.serviceWorker.controller === registration.active
			})
		).toBe(true)
	} finally {
		await writeFile(workerPath, original)
	}
})

test(
	'serves a saved transaction detail directly and after reload in production',
	{ tag: [] },
	async ({ page, browserName }) => {
		await page.goto('/accounts')
		await openCreationModal(page, 'Add Account')
		await creationDialog(page, 'Add Account')
			.getByLabel('Account name')
			.fill('Production detail checking')
		await creationDialog(page, 'Add Account').getByLabel('Account type').selectOption('bank')
		await creationDialog(page, 'Add Account')
			.getByRole('button', { name: 'Add Account', exact: true })
			.click()
		await expect(creationDialog(page, 'Add Account').getByRole('status')).toContainText(
			'Production detail checking'
		)
		await page.goto('/expenses/new')
		await page
			.getByLabel('Account', { exact: true })
			.selectOption({ label: 'Production detail checking · USD' })
		await page.getByLabel('Amount', { exact: true }).fill('12.34')
		await page.getByLabel('Date', { exact: true }).fill('2026-03-10')
		await page.getByLabel('Description', { exact: true }).fill('Production detail verification')
		await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(page).toHaveURL(/\/expenses\?workspace=[a-f0-9-]+$/)
		const link = page
			.getByRole('main')
			.getByRole('link', { name: /Transaction details:.*Production detail verification/ })
		const href = await link.getAttribute('href')
		if (!href) throw new Error('Expected a transaction detail link.')
		const response = await page.goto(href)
		expect(response?.status()).toBe(200)
		expect(response?.fromServiceWorker()).toBe(true)
		// A controlled detail navigation receives the route-neutral public shell, not account data.
		// Firefox's protocol cannot read this cached response body (invalid content encoding).
		// Check the mapped public shell in Cache Storage there; retain the wire-body check elsewhere.
		const publicHtml =
			browserName === 'firefox'
				? await page.evaluate(async () => {
						const names = (await caches.keys()).filter((name) =>
							name.startsWith('delightful-finance-shell-')
						)
						for (const name of names) {
							const shell = await (await caches.open(name)).match('/offline')
							if (shell) return shell.text()
						}
						throw new Error('Missing cached public detail shell')
					})
				: await response?.text()
		expect(publicHtml).not.toContain('Production detail verification')
		await expect(
			page.getByRole('heading', { name: 'Transaction details', exact: true })
		).toBeVisible()
		await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
			'Production detail verification'
		)
		await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
		await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-03-10')
		const reload = await page.reload()
		expect(reload?.status()).toBe(200)
		await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
			'Production detail verification'
		)
	}
)

test('serves the localized install manifest from the service worker while offline', async ({
	page,
	context
}) => {
	await context.setOffline(true)
	try {
		const responsePromise = page.waitForResponse(
			(response) => new URL(response.url()).pathname === '/manifest.webmanifest'
		)
		const manifest = await page.evaluate(async () => {
			const response = await fetch('/manifest.webmanifest', { cache: 'no-store' })
			return {
				status: response.status,
				contentType: response.headers.get('Content-Type'),
				value: await response.json()
			}
		})
		const response = await responsePromise
		expect(response.fromServiceWorker()).toBe(true)
		expect(manifest.status).toBe(200)
		expect(manifest.contentType).toContain('application/manifest+json')
		expect(manifest.value).toMatchObject({
			name: 'Delightful Finance',
			short_name: 'Finance',
			description: 'A local-first personal finance tracker.',
			lang: 'en',
			dir: 'ltr',
			id: '/',
			start_url: '/',
			scope: '/'
		})
	} finally {
		await context.setOffline(false)
	}
})

test('a worker update preserves drafts in two tabs and activates after both close', async ({
	page,
	context
}) => {
	await page.goto('/accounts')
	await openCreationModal(page, 'Add Account')
	await creationDialog(page, 'Add Account').getByLabel('Account name').fill('First tab draft')
	const second = await context.newPage()
	await second.goto('/accounts')
	await openCreationModal(second, 'Add Account')
	await creationDialog(second, 'Add Account').getByLabel('Account name').fill('Second tab draft')
	await expect
		.poll(() => second.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true)

	let firstNavigations = 0
	let secondNavigations = 0
	page.on('framenavigated', (frame) => {
		if (frame === page.mainFrame()) firstNavigations += 1
	})
	second.on('framenavigated', (frame) => {
		if (frame === second.mainFrame()) secondNavigations += 1
	})
	const firstController = await page.evaluateHandle(() => navigator.serviceWorker.controller)
	const secondController = await second.evaluateHandle(() => navigator.serviceWorker.controller)
	const workerPath = '.svelte-kit/output/client/service-worker.js'
	const original = await readFile(workerPath, 'utf8')
	try {
		const workerStarted = context.waitForEvent('serviceworker')
		await writeFile(workerPath, `${original}\n// Playwright multi-tab update fixture\n`)
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready
			await registration.update()
		})
		const updatedWorker = await workerStarted
		for (const tab of [page, second]) {
			await expect
				.poll(() => tab.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state))
				.toBe('installed')
		}
		expect(
			await page.evaluate((old) => navigator.serviceWorker.controller === old, firstController)
		).toBe(true)
		expect(
			await second.evaluate((old) => navigator.serviceWorker.controller === old, secondController)
		).toBe(true)
		await expect(creationDialog(page, 'Add Account').getByLabel('Account name')).toHaveValue(
			'First tab draft'
		)
		await expect(creationDialog(second, 'Add Account').getByLabel('Account name')).toHaveValue(
			'Second tab draft'
		)
		expect(firstNavigations).toBe(0)
		expect(secondNavigations).toBe(0)

		await page.close()
		await expect
			.poll(() => second.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state))
			.toBe('installed')
		expect(
			await second.evaluate((old) => navigator.serviceWorker.controller === old, secondController)
		).toBe(true)
		await expect(creationDialog(second, 'Add Account').getByLabel('Account name')).toHaveValue(
			'Second tab draft'
		)
		expect(secondNavigations).toBe(0)
		await second.close()

		// Observe the new worker without opening another controlled page during activation.
		await expect
			.poll(() =>
				updatedWorker.evaluate(
					'self.registration.waiting === null && self.registration.active?.state === "activated"'
				)
			)
			.toBe(true)
		const reopened = await context.newPage()
		await reopened.goto('/accounts')
		await openCreationModal(reopened, 'Add Account')
		await expect(creationDialog(reopened, 'Add Account').getByLabel('Account name')).toBeVisible()
		await expect
			.poll(() =>
				reopened.evaluate(async () => {
					const registration = await navigator.serviceWorker.ready
					return (
						!registration.waiting &&
						registration.active?.state === 'activated' &&
						navigator.serviceWorker.controller === registration.active
					)
				})
			)
			.toBe(true)
	} finally {
		await writeFile(workerPath, original)
		if (!second.isClosed()) await second.close()
	}
})

// Mutate only generated output, restore it even on failure, and keep this suite serial.
async function withReadyUpdate(page: Page, verify: () => Promise<void>) {
	const workerPath = '.svelte-kit/output/client/service-worker.js'
	const original = await readFile(workerPath, 'utf8')
	try {
		await writeFile(workerPath, `${original}\n// Update notice fixture ${Date.now()}\n`)
		await page.evaluate(async () => {
			await (await navigator.serviceWorker.ready).update()
		})
		await expect
			.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state))
			.toBe('installed')
		await verify()
	} finally {
		await writeFile(workerPath, original)
	}
}

const updateStatus = (page: Page) => page.locator('.sidebar-status > div > p[role="status"]')
const updateAction = (page: Page) =>
	page.locator('aside').getByRole('button', { name: 'Update and reload', exact: true })

test('update status stays mounted, Later survives navigation, and reload rediscovers the update', async ({
	page
}) => {
	const status = updateStatus(page)
	await expect(status).toHaveCount(1)
	await expect(status).toBeEmpty()
	await expect(updateAction(page)).toHaveCount(0)
	const originalRegion = await status.elementHandle()
	if (!originalRegion) throw new Error('Expected the initially empty live region')
	await withReadyUpdate(page, async () => {
		await expect(status).toHaveText('A new version is available.')
		expect(
			await originalRegion.evaluate(
				(element) => element === document.querySelector('.sidebar-status > div > p[role="status"]')
			)
		).toBe(true)
		expect(
			await status.evaluate((element) => Boolean(element.parentElement?.nextElementSibling))
		).toBe(true)
		const later = page.locator('aside').getByRole('button', { name: 'Later', exact: true })
		await later.focus()
		await later.press('Enter')
		await expect(status).toBeEmpty()
		await navigateSidebar(page, 'Accounts')
		await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
		await expect(updateAction(page)).toHaveCount(0)
		expect(await originalRegion.evaluate((element) => element.isConnected)).toBe(true)
		await page.reload()
		await expect(updateStatus(page)).toHaveText('A new version is available.')
	})
})

test(
	'accepting an update reloads once, retains saved data, and does not check unsaved edits',
	{ tag: [] },
	async ({ page }) => {
		await navigateSidebar(page, 'Accounts')
		await expect(page).toHaveURL(/\/accounts\?workspace=[a-f0-9-]+$/)
		await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
		await openCreationModal(page, 'Add Account')
		await creationDialog(page, 'Add Account')
			.getByLabel('Account name')
			.fill('Update persistence account')
		await creationDialog(page, 'Add Account').getByLabel('Account type').selectOption('bank')
		await creationDialog(page, 'Add Account')
			.getByRole('button', { name: 'Add Account', exact: true })
			.click()
		await expect(creationDialog(page, 'Add Account').getByRole('status')).toContainText(
			'Update persistence account'
		)
		await page.goto('/expenses/new')
		await page.getByLabel('Amount', { exact: true }).fill('42.13')
		await page.getByLabel('Description', { exact: true }).fill('Unsubmitted update draft')
		let navigations = 0
		let dialogs = 0
		page.on('framenavigated', (frame) => {
			if (frame === page.mainFrame()) navigations += 1
		})
		page.on('dialog', async (dialog) => {
			dialogs += 1
			await dialog.dismiss()
		})
		await withReadyUpdate(page, async () => {
			await expect(updateAction(page)).toBeVisible()
			await updateAction(page).click()
			await expect(page.getByLabel('Description', { exact: true })).toHaveValue('')
			await expect(page.getByLabel('Account', { exact: true })).toContainText(
				'Update persistence account'
			)
			await expect(updateStatus(page)).toBeEmpty()
			expect(navigations).toBe(1)
			expect(dialogs).toBe(0)
			expect(
				await page.evaluate(async () => {
					const registration = await navigator.serviceWorker.ready
					return (
						registration.waiting === null &&
						navigator.serviceWorker.controller === registration.active
					)
				})
			).toBe(true)
		})
	}
)

test('an activation error shows retry and retry activates the waiting update', async ({ page }) => {
	await withReadyUpdate(page, async () => {
		await expect(updateAction(page)).toBeVisible()
		await page.evaluate(async () => {
			const worker = (await navigator.serviceWorker.ready).waiting
			if (!worker) throw new Error('Expected waiting update')
			const original = worker.postMessage
			let fail = true
			Object.defineProperty(worker, 'postMessage', {
				configurable: true,
				value: (...args: unknown[]) => {
					if (fail) {
						fail = false
						throw new Error('Synthetic activation error')
					}
					return Reflect.apply(original, worker, args)
				}
			})
		})
		await updateAction(page).click()
		await expect(updateStatus(page)).toHaveText(
			'The update could not be completed. You can try again.'
		)
		await page.locator('aside').getByRole('button', { name: 'Try again', exact: true }).click()
		await expect(updateStatus(page)).toBeEmpty()
		await expect(updateAction(page)).toHaveCount(0)
	})
})

test(
	'acceptance in one tab offers reload in the other without replacing its draft',
	{ tag: [] },
	async ({ page, context }) => {
		await navigateSidebar(page, 'Accounts')
		await expect(page).toHaveURL(/\/accounts\?workspace=[a-f0-9-]+$/)
		await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
		await openCreationModal(page, 'Add Account')
		await creationDialog(page, 'Add Account')
			.getByLabel('Account name')
			.fill('Multi-tab update account')
		await creationDialog(page, 'Add Account').getByLabel('Account type').selectOption('bank')
		await creationDialog(page, 'Add Account')
			.getByRole('button', { name: 'Add Account', exact: true })
			.click()
		await expect(creationDialog(page, 'Add Account').getByRole('status')).toContainText(
			'Multi-tab update account'
		)
		await page.goto('/accounts')
		const second = await context.newPage()
		try {
			await second.goto('/expenses/new')
			await second.getByLabel('Description', { exact: true }).fill('Second tab keeps this draft')
			let firstNavigations = 0
			let secondNavigations = 0
			page.on('framenavigated', (frame) => {
				if (frame === page.mainFrame()) firstNavigations += 1
			})
			second.on('framenavigated', (frame) => {
				if (frame === second.mainFrame()) secondNavigations += 1
			})
			await withReadyUpdate(page, async () => {
				await expect(updateAction(page)).toBeVisible()
				await expect(updateAction(second)).toBeVisible()
				await updateAction(page).click()
				await expect(updateStatus(page)).toBeEmpty()
				await expect(updateStatus(second)).toHaveText('A new version is active. Reload to use it.')
				await expect(second.getByLabel('Description', { exact: true })).toHaveValue(
					'Second tab keeps this draft'
				)
				expect(firstNavigations).toBe(1)
				expect(secondNavigations).toBe(0)
				await updateAction(second).click()
				await expect(second.getByLabel('Description', { exact: true })).toHaveValue('')
				await expect(updateStatus(second)).toBeEmpty()
				expect(secondNavigations).toBe(1)
			})
		} finally {
			await second.close()
		}
	}
)
