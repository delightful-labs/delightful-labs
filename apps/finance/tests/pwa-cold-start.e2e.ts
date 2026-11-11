import { glob, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { closeCreationModal, creationDialog, openCreationModal } from './helpers/ui.js'

async function prepareShell(page: Page) {
	await page.goto('/accounts')
	await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready
	})
	await page.reload()
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true)
}

test('precaches emitted worker Wasm and serves it without the HTTP cache', async ({
	page,
	context
}) => {
	await prepareShell(page)
	const clientRoot = '.svelte-kit/output/client'
	const requiredPaths: string[] = []
	for await (const file of glob(`${clientRoot}/_app/immutable/**/*.wasm`)) {
		requiredPaths.push(`/${relative(clientRoot, file).split(sep).join('/')}`)
	}
	expect(requiredPaths.length).toBeGreaterThan(0)
	const cachedPaths = await page.evaluate(async () => {
		const names = (await caches.keys()).filter((name) =>
			name.startsWith('delightful-finance-shell-')
		)
		const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()))
		return requests.flat().map((request) => new URL(request.url).pathname)
	})
	expect(cachedPaths).toEqual(expect.arrayContaining(requiredPaths))
	const cdp = await context.newCDPSession(page)
	await cdp.send('Network.enable')
	await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
	await context.setOffline(true)
	for (const path of requiredPaths) {
		const responsePromise = page.waitForResponse(
			(response) => new URL(response.url()).pathname === path
		)
		const header = await page.evaluate(async (path) => {
			const response = await fetch(path, { cache: 'no-store' })
			return {
				status: response.status,
				magic: [...new Uint8Array(await response.arrayBuffer()).slice(0, 4)]
			}
		}, path)
		expect((await responsePromise).fromServiceWorker()).toBe(true)
		expect(header).toEqual({ status: 200, magic: [0, 97, 115, 109] })
	}
})

test('reopens a saved account offline after the browser and database worker exit', async ({
	playwright,
	baseURL,
	browserName
}) => {
	test.skip(browserName !== 'chromium', 'HTTP-cache isolation uses Chromium CDP')
	test.setTimeout(90_000)
	if (!baseURL) throw new Error('Expected production preview URL')
	const profile = await mkdtemp(join(tmpdir(), 'delightful-finance-cold-start-'))
	let current: BrowserContext | undefined
	try {
		current = await playwright.chromium.launchPersistentContext(profile, {
			baseURL,
			serviceWorkers: 'allow'
		})
		const warm = current.pages()[0] ?? (await current.newPage())
		await prepareShell(warm)
		await openCreationModal(warm, 'Add Account')
		const dialog = creationDialog(warm, 'Add Account')
		await dialog.getByLabel('Account name').fill('Cold runtime ledger')
		await dialog.getByLabel('Account type').selectOption('cash')
		await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText('Cold runtime ledger')
		await closeCreationModal(warm)
		await expect(warm.getByRole('cell', { name: 'Cold runtime ledger', exact: true })).toBeVisible()
		const url = new URL(warm.url())
		const route = `${url.pathname}${url.search}`
		const cdp = await current.newCDPSession(warm)
		await cdp.send('Network.enable')
		// Preserve Cache Storage, localStorage and IndexedDB; remove the HTTP-cache fallback.
		await cdp.send('Network.clearBrowserCache')
		// Closing a persistent context exits its browser, including its SharedWorker runtime.
		await current.close()
		current = undefined
		current = await playwright.chromium.launchPersistentContext(profile, {
			baseURL,
			serviceWorkers: 'allow',
			offline: true
		})
		const cold = current.pages()[0] ?? (await current.newPage())
		const errors: string[] = []
		cold.on('pageerror', (error) => errors.push(error.message))
		const response = await cold.goto(route)
		expect(response?.fromServiceWorker()).toBe(true)
		await expect(cold.getByRole('cell', { name: 'Cold runtime ledger', exact: true })).toBeVisible({
			timeout: 30_000
		})
		expect(errors).toEqual([])
	} finally {
		await current?.close()
		await rm(profile, { recursive: true, force: true })
	}
})

for (const direction of ['expenses', 'income']) {
	test(
		`reopens saved ${direction} detail at its original URL after a cold offline restart`,
		{ tag: [] },
		async ({ playwright, baseURL, browserName }) => {
			test.skip(browserName !== 'chromium', 'HTTP-cache isolation uses Chromium CDP')
			test.setTimeout(90_000)
			if (!baseURL) throw new Error('Expected production preview URL')
			const profile = await mkdtemp(join(tmpdir(), 'delightful-finance-cold-detail-'))
			let current: BrowserContext | undefined
			try {
				current = await playwright.chromium.launchPersistentContext(profile, {
					baseURL,
					serviceWorkers: 'allow'
				})
				const warm = current.pages()[0] ?? (await current.newPage())
				await prepareShell(warm)
				await openCreationModal(warm, 'Add Account')
				const dialog = creationDialog(warm, 'Add Account')
				await dialog.getByLabel('Account name').fill('Cold detail ledger')
				await dialog.getByLabel('Account type').selectOption('cash')
				await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
				await expect(dialog.getByRole('status')).toContainText('Cold detail ledger')
				await closeCreationModal(warm)
				const workspaceId = new URL(warm.url()).searchParams.get('workspace')
				if (!workspaceId) throw new Error('Expected scoped workspace after startup')
				await warm.goto(`/${direction}/new?workspace=${workspaceId}`)
				await warm
					.getByLabel('Account', { exact: true })
					.selectOption({ label: 'Cold detail ledger · USD' })
				await warm.getByLabel('Amount', { exact: true }).fill('12.34')
				await warm.getByLabel('Date', { exact: true }).fill('2026-03-10')
				const description = `Cold ${direction} detail`
				await warm.getByLabel('Description', { exact: true }).fill(description)
				await warm.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				const link = warm
					.getByRole('main')
					.getByRole('link', { name: new RegExp(`Transaction details:.*${description}`) })
				await expect(link).toBeVisible()
				const href = await link.getAttribute('href')
				if (!href) throw new Error('Expected saved detail URL')
				const target = new URL(href, baseURL)
				target.hash = 'details'
				await warm.goto(target.href)
				await expect(
					warm.getByRole('heading', { name: 'Transaction details', exact: true })
				).toBeVisible()
				await expect(warm.getByLabel('Description', { exact: true })).toHaveValue(description)
				const cdp = await current.newCDPSession(warm)
				await cdp.send('Network.enable')
				await cdp.send('Network.clearBrowserCache')
				await current.close()
				current = undefined
				current = await playwright.chromium.launchPersistentContext(profile, {
					baseURL,
					serviceWorkers: 'allow',
					offline: true
				})
				const cold = current.pages()[0] ?? (await current.newPage())
				const errors: string[] = []
				cold.on('pageerror', (error) => errors.push(error.message))
				const response = await cold.goto(target.href)
				expect(response?.status()).toBe(200)
				expect(response?.fromServiceWorker()).toBe(true)
				expect(await response?.text()).not.toContain(description)
				await expect(cold).toHaveURL(target.href)
				await expect(
					cold.getByRole('heading', { name: 'Transaction details', exact: true })
				).toBeVisible({ timeout: 30000 })
				await expect(cold.getByLabel('Description', { exact: true })).toHaveValue(description)
				await expect(cold.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
				await expect(cold.getByLabel('Date', { exact: true })).toHaveValue('2026-03-10')
				expect(new URL(cold.url()).searchParams.get('workspace')).toBe(workspaceId)
				const reload = await cold.reload()
				expect(reload?.fromServiceWorker()).toBe(true)
				await expect(cold.getByLabel('Description', { exact: true })).toHaveValue(description)
				expect(errors).toEqual([])
			} finally {
				await current?.close()
				await rm(profile, { recursive: true, force: true })
			}
		}
	)
}

test('detail fallback excludes fetches, POST documents, APIs and unsupported paths', async ({
	page,
	context
}) => {
	await prepareShell(page)
	const cdp = await context.newCDPSession(page)
	await cdp.send('Network.enable')
	await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
	await context.setOffline(true)
	const id = '11111111-1111-4111-8111-111111111111'
	const detail = `/expenses/${id}`
	for (const path of [detail, `/transfers/${id}`, '/api/simplefin']) {
		const result = await page.evaluate(async (path) => {
			try {
				const response = await fetch(path, { cache: 'no-store' })
				return { failed: false, status: response.status }
			} catch {
				return { failed: true }
			}
		}, path)
		expect(result.failed).toBe(true)
	}
	for (const path of [
		'/unknown-offline-route',
		'/api/simplefin',
		'/expenses/not-a-uuid',
		'/transfers/not-a-uuid',
		`${detail}/extra`,
		`/EXPENSES/${id}`
	]) {
		const document = await context.newPage()
		try {
			await expect(document.goto(new URL(path, page.url()).href)).rejects.toThrow(
				/ERR_INTERNET_DISCONNECTED/
			)
		} finally {
			await document.close()
		}
	}
	const failedPost = page.waitForEvent('requestfailed', {
		predicate: (request) => request.isNavigationRequest() && request.method() === 'POST'
	})
	await page.evaluate((path) => {
		const form = document.createElement('form')
		form.method = 'POST'
		form.action = path
		document.body.append(form)
		form.submit()
	}, detail)
	expect((await failedPost).failure()?.errorText).toContain('ERR_INTERNET_DISCONNECTED')
})

test('reopens a saved transfer with disabled fields after a cold offline restart', async ({
	playwright,
	baseURL,
	browserName
}) => {
	test.skip(browserName !== 'chromium', 'HTTP-cache isolation uses Chromium CDP')
	test.setTimeout(90_000)
	if (!baseURL) throw new Error('Expected production preview URL')
	const profile = await mkdtemp(join(tmpdir(), 'delightful-finance-cold-transfer-'))
	let current: BrowserContext | undefined
	try {
		current = await playwright.chromium.launchPersistentContext(profile, {
			baseURL,
			serviceWorkers: 'allow'
		})
		const warm = current.pages()[0] ?? (await current.newPage())
		await prepareShell(warm)
		for (const name of ['Cold source', 'Cold destination']) {
			await openCreationModal(warm, 'Add Account')
			const dialog = creationDialog(warm, 'Add Account')
			await dialog.getByLabel('Account name').fill(name)
			await dialog.getByLabel('Account type').selectOption('cash')
			await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
			await expect(dialog.getByRole('status')).toContainText(name)
			await closeCreationModal(warm)
		}
		const workspaceId = new URL(warm.url()).searchParams.get('workspace')
		if (!workspaceId) throw new Error('Expected scoped workspace after startup')
		await warm.goto(`/transfers/new?workspace=${workspaceId}`)
		await warm
			.getByLabel('Source Account', { exact: true })
			.selectOption({ label: 'Cold source · USD' })
		await warm
			.getByLabel('Destination Account', { exact: true })
			.selectOption({ label: 'Cold destination · USD' })
		await warm.getByLabel('Amount', { exact: true }).fill('12.34')
		await warm.getByLabel('Date', { exact: true }).fill('2026-03-10')
		await warm.getByRole('button', { name: 'Save Transfer', exact: true }).click()
		await expect(warm.locator('form').getByRole('status')).toHaveText('Transfer saved.')
		const link = warm.getByRole('link', {
			name: /Transfer details: Cold source → Cold destination/
		})
		await expect(link).toBeVisible()
		const href = await link.getAttribute('href')
		if (!href) throw new Error('Expected transfer detail URL')
		const target = new URL(href, baseURL)
		target.hash = 'details'
		await warm.goto(target.href)
		await expect(warm.getByLabel('Source Amount', { exact: true })).toHaveValue('12.34')
		const cdp = await current.newCDPSession(warm)
		await cdp.send('Network.enable')
		await cdp.send('Network.clearBrowserCache')
		await current.close()
		current = undefined
		current = await playwright.chromium.launchPersistentContext(profile, {
			baseURL,
			serviceWorkers: 'allow',
			offline: true
		})
		const cold = current.pages()[0] ?? (await current.newPage())
		const errors: string[] = []
		cold.on('pageerror', (error) => errors.push(error.message))
		const response = await cold.goto(target.href)
		expect(response?.status()).toBe(200)
		expect(response?.fromServiceWorker()).toBe(true)
		expect(await response?.text()).not.toContain('Cold source')
		await expect(cold).toHaveURL(target.href)
		await expect(cold.getByRole('heading', { name: 'Transfer details', exact: true })).toBeVisible({
			timeout: 30_000
		})
		await expect(
			cold.getByLabel('Source Account', { exact: true }).locator('option:checked')
		).toHaveText('Cold source · USD')
		await expect(
			cold.getByLabel('Destination Account', { exact: true }).locator('option:checked')
		).toHaveText('Cold destination · USD')
		await expect(cold.getByLabel('Source Amount', { exact: true })).toHaveValue('12.34')
		await expect(cold.getByLabel('Destination Amount', { exact: true })).toHaveValue('12.34')
		await expect(cold.getByLabel('Source Date', { exact: true })).toHaveValue('2026-03-10')
		await expect(cold.getByLabel('Destination Date', { exact: true })).toHaveValue('2026-03-10')
		for (const field of await cold
			.locator('.transaction-content form input, .transaction-content form select')
			.all())
			await expect(field).toBeDisabled()
		await expect(cold.getByRole('link', { name: 'Expense details', exact: true })).toHaveAttribute(
			'href',
			new RegExp(`/expenses/[a-f0-9-]+\\?workspace=${workspaceId}`)
		)
		await expect(cold.getByRole('link', { name: 'Income details', exact: true })).toHaveAttribute(
			'href',
			new RegExp(`/income/[a-f0-9-]+\\?workspace=${workspaceId}`)
		)
		const reload = await cold.reload()
		expect(reload?.fromServiceWorker()).toBe(true)
		await expect(cold.getByLabel('Source Amount', { exact: true })).toHaveValue('12.34')
		expect(errors).toEqual([])
	} finally {
		await current?.close()
		await rm(profile, { recursive: true, force: true })
	}
})
