import { expect, test, type Page } from '@playwright/test'
import { navigateSidebar } from './helpers/ui.js'

declare global {
	interface Window {
		polishObjectUrls: { created: string[]; revoked: string[] }
		polishTransitions: { calls: number; mode: 'native' | 'skipped' | 'rejected' }
	}
}

async function seed(page: Page) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled()
	return page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Missing polish fixture session')
		const db = snapshot.client.db
		const organizationId = new URL(location.href).searchParams.get('workspace')
		if (!organizationId) throw new Error('Missing polish workspace')
		const categories = await db.all(app.categories.where({ organizationId, isSystem: true }))
		const tx = db.beginTransaction()
		const account = tx.insert(app.accounts, {
			organizationId,
			name: 'Polish ledger',
			kind: 'bank',
			currency: 'USD'
		})
		const rows: { kind: 'expense' | 'income'; id: string }[] = []
		for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
			const category = categories.find((row) => row.kind === kind)
			if (!category) throw new Error('Missing polish category')
			for (let index = 0; index < 26; index += 1) {
				const row = tx.insert(app.transactions, {
					organizationId,
					accountId: account.id,
					categoryId: category.id,
					kind,
					amountMinor: 100,
					currency: 'USD',
					bookedOn: '2026-10-25',
					description: `Polish ${kind} ${index}`,
					source: 'manual'
				})
				if (index === 0) rows.push({ kind, id: row.id })
			}
		}
		await tx.commit().wait({ tier: 'global' })
		return { organizationId, userId: snapshot.account.id, rows }
	})
}

async function setAvatar(
	page: Page,
	mode: 'valid' | 'replacement' | 'broken' | 'missing' | 'nameless'
) {
	await page.evaluate(async (mode) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Missing avatar session')
		const db = snapshot.client.db
		const profile = await db.one(app.profiles.where({ userId: snapshot.account.id }))
		if (!profile) throw new Error('Missing avatar profile')
		const canvas = new OffscreenCanvas(8, 8)
		const drawing = canvas.getContext('2d')
		if (!drawing) throw new Error('Canvas unavailable')
		drawing.fillStyle = mode === 'replacement' ? '#102030' : '#406080'
		drawing.fillRect(0, 0, 8, 8)
		const image = await canvas.convertToBlob({ type: 'image/png' })
		await db
			.update(app.profiles, profile.id, {
				displayName: mode === 'nameless' ? '' : 'Polish author',
				avatarData:
					mode === 'missing' || mode === 'nameless'
						? null
						: mode === 'broken'
							? new Uint8Array([1, 2, 3])
							: new Uint8Array(await image.arrayBuffer()),
				avatarMimeType: mode === 'missing' || mode === 'nameless' ? null : 'image/png'
			})
			.wait({ tier: 'local' })
	}, mode)
}

async function installUrlTracking(page: Page) {
	await page.addInitScript(() => {
		window.polishObjectUrls = { created: [], revoked: [] }
		const create = URL.createObjectURL.bind(URL)
		const revoke = URL.revokeObjectURL.bind(URL)
		URL.createObjectURL = (value) => {
			const url = create(value)
			window.polishObjectUrls.created.push(url)
			return url
		}
		URL.revokeObjectURL = (url) => {
			window.polishObjectUrls.revoked.push(url)
			revoke(url)
		}
	})
}

async function revoked(page: Page, urls: string[]) {
	await expect
		.poll(() =>
			page.evaluate(
				(urls) => urls.every((url) => window.polishObjectUrls.revoked.includes(url)),
				urls
			)
		)
		.toBe(true)
}

test(
	'attribution avatars retain fallback names and revoke URLs on replacement, removal and navigation',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await installUrlTracking(page)
		const fixture = await seed(page)
		const transaction = fixture.rows.find((row) => row.kind === 'expense')
		if (!transaction) throw new Error('Missing expense fixture')
		await page.goto(`/expenses/${transaction.id}?workspace=${fixture.organizationId}`)
		const metadata = page
			.locator('details')
			.filter({ has: page.locator('summary', { hasText: 'Metadata' }) })
		await metadata.locator('summary').click()
		const authors = metadata.locator('.attribution')
		const images = authors.locator('img')
		await expect(authors).toHaveText([fixture.userId, fixture.userId])
		await expect(images).toHaveCount(0)
		await setAvatar(page, 'valid')
		await expect(authors).toHaveText(['Polish author', 'Polish author'])
		await expect(images).toHaveCount(2)
		for (const image of await images.all()) {
			await expect(image).toHaveAttribute('alt', '')
			await expect
				.poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth))
				.toBe(8)
		}
		const original = await images.evaluateAll((images) =>
			images.map((image) => image.getAttribute('src') ?? '')
		)
		await setAvatar(page, 'replacement')
		await expect
			.poll(() => images.evaluateAll((images) => images.map((image) => image.getAttribute('src'))))
			.not.toEqual(original)
		await revoked(page, original)
		const replacement = await images.evaluateAll((images) =>
			images.map((image) => image.getAttribute('src') ?? '')
		)
		const createdBeforeBroken = await page.evaluate(() => window.polishObjectUrls.created.length)
		await setAvatar(page, 'broken')
		await expect(images).toHaveCount(0)
		await expect(authors).toHaveText(['Polish author', 'Polish author'])
		await revoked(page, replacement)
		const brokenUrls = await page.evaluate(
			(index) => window.polishObjectUrls.created.slice(index),
			createdBeforeBroken
		)
		await setAvatar(page, 'missing')
		await expect(images).toHaveCount(0)
		await revoked(page, brokenUrls)
		await setAvatar(page, 'nameless')
		await expect(authors).toHaveText([fixture.userId, fixture.userId])
		await setAvatar(page, 'valid')
		await expect(images).toHaveCount(2)
		const last = await images.evaluateAll((images) =>
			images.map((image) => image.getAttribute('src') ?? '')
		)
		await navigateSidebar(page, 'Account')
		await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Polish author')
		await revoked(page, last)
		const avatar = page
			.getByRole('group')
			.filter({ has: page.getByLabel('Avatar', { exact: true }) })
		await expect(avatar.locator('img')).toBeVisible()
		const savedTrigger = page.getByRole('button', { name: 'Avatar details: avatar', exact: true })
		await savedTrigger.click()
		const preview = page.getByRole('dialog', { name: 'avatar', exact: true })
		await expect(preview.getByRole('button', { name: 'Remove Avatar', exact: true })).toBeEnabled()
		await preview.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(savedTrigger).toBeFocused()
		await expect
			.poll(() => avatar.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
			.toBe(8)
		const savedPreview = await avatar.locator('img').getAttribute('src')
		const bytes = await page.evaluate(async () => {
			const canvas = new OffscreenCanvas(4, 4)
			const drawing = canvas.getContext('2d')
			if (!drawing) throw new Error('Canvas unavailable')
			drawing.fillRect(0, 0, 4, 4)
			const blob = await canvas.convertToBlob({ type: 'image/png' })
			return Array.from(new Uint8Array(await blob.arrayBuffer()))
		})
		await savedTrigger.click()
		await page
			.getByLabel('Avatar', { exact: true })
			.setInputFiles({ name: 'unsaved.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
		const cropDialog = page.getByRole('dialog', { name: 'Crop your avatar', exact: true })
		await expect(cropDialog).toBeVisible()
		await cropDialog.getByRole('button', { name: 'Use this crop', exact: true }).click()
		await expect(cropDialog).not.toBeVisible()
		await expect(page.getByRole('button', { name: 'Save Avatar', exact: true })).toBeVisible()
		await expect
			.poll(() => avatar.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
			.toBe(4)
		await page.getByRole('button', { name: 'Avatar details: unsaved.png', exact: true }).click()
		const selectedPreview = page.getByRole('dialog', { name: 'unsaved.png', exact: true })
		await selectedPreview.getByRole('button', { name: 'Clear selected Image', exact: true }).focus()
		await selectedPreview
			.getByRole('button', { name: 'Clear selected Image', exact: true })
			.press('Enter')
		await expect(selectedPreview).toBeHidden()
		await expect(page.getByRole('button', { name: 'Save Avatar', exact: true })).toHaveCount(0)
		await expect
			.poll(() => avatar.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
			.toBe(8)
		if (savedPreview) await revoked(page, [savedPreview])
		const restoredPreview = await avatar.locator('img').getAttribute('src')
		await savedTrigger.click()
		await preview.getByRole('button', { name: 'Remove Avatar', exact: true }).focus()
		await preview.getByRole('button', { name: 'Remove Avatar', exact: true }).press('Enter')
		await expect(preview).toBeHidden()
		await expect(avatar.locator('img')).toHaveCount(0)
		if (restoredPreview) await revoked(page, [restoredPreview])
		await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Polish author')
	}
)

for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
	test(
		`mobile ${kind} back link preserves list scope and pagination and stays absent elsewhere`,
		{ tag: ['@transactions', '@workspaces'] },
		async ({ page }) => {
			const fixture = await seed(page)
			const transaction = fixture.rows.find((row) => row.kind === kind)
			if (!transaction) throw new Error('Missing back-link fixture')
			const route = kind === 'expense' ? '/expenses' : '/income'
			await page.setViewportSize({ width: 390, height: 900 })
			await page.goto(`${route}/${transaction.id}?workspace=${fixture.organizationId}&page=2`)
			await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
			const back = page.getByRole('link', { name: 'Back to List', exact: true })
			await expect(back).toHaveAttribute(
				'href',
				`${route}?workspace=${fixture.organizationId}&page=2`
			)
			await back.click()
			await expect(page).toHaveURL(`${route}?workspace=${fixture.organizationId}&page=2`)
			await expect(
				page
					.getByRole('navigation', { name: 'Transaction pages', exact: true })
					.locator('[aria-current="page"]')
			).toHaveText('2')
			await expect(back).toHaveCount(0)
			await page.goto(`${route}/new?workspace=${fixture.organizationId}&page=2`)
			await expect(page.getByLabel('Amount', { exact: true })).toBeVisible()
			await expect(back).toHaveCount(0)
			await page.setViewportSize({ width: 1280, height: 900 })
			await page.goto(`${route}/${transaction.id}?workspace=${fixture.organizationId}&page=2`)
			await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
			await expect(back).toHaveCount(0)
		}
	)
}

async function trackTransitions(page: Page, unavailable = false) {
	await page.addInitScript((unavailable) => {
		window.polishTransitions = { calls: 0, mode: 'native' }
		if (unavailable) {
			Object.defineProperty(document, 'startViewTransition', {
				configurable: true,
				value: undefined
			})
			return
		}
		const native = document.startViewTransition.bind(document)
		document.startViewTransition = (...args) => {
			window.polishTransitions.calls += 1
			if (window.polishTransitions.mode === 'rejected') {
				const failure = Promise.reject(new Error('Deliberately rejected transition capture'))
				void failure.catch(() => {})
				return {
					ready: failure,
					finished: Promise.resolve(),
					updateCallbackDone: failure,
					types: new Set<string>(),
					skipTransition() {}
				}
			}
			const transition = native(...args)
			if (window.polishTransitions.mode === 'skipped') transition.skipTransition()
			void transition.ready.catch(() => {})
			void transition.finished.catch(() => {})
			return transition
		}
	}, unavailable)
}

test(
	'transaction transitions cover path and history navigation but skip query, hash and outside routes',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await trackTransitions(page)
		const fixture = await seed(page)
		await page.goto(`/expenses?workspace=${fixture.organizationId}`)
		await expect(
			page.getByRole('main').getByRole('link', { name: /Transaction details:.*Polish expense/ })
		).toHaveCount(25)
		await expect.poll(() => page.evaluate(() => window.polishTransitions.calls)).toBe(0)
		await page.getByRole('link', { name: 'Add Expenses', exact: true }).click()
		await expect(page.getByLabel('Amount', { exact: true })).toBeVisible()
		await expect.poll(() => page.evaluate(() => window.polishTransitions.calls)).toBe(1)
		await page.locator('aside').getByRole('link', { name: 'Expenses', exact: true }).click()
		await expect.poll(() => page.evaluate(() => window.polishTransitions.calls)).toBe(2)
		const transactionLink = page
			.getByRole('main')
			.getByRole('link', { name: /Transaction details:.*Polish expense/ })
			.first()
		await transactionLink.focus()
		await transactionLink.press('Enter')
		await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
		await expect.poll(() => page.evaluate(() => window.polishTransitions.calls)).toBe(3)
		await page.goBack()
		await expect(page).toHaveURL(`/expenses?workspace=${fixture.organizationId}`)
		await expect.poll(() => page.evaluate(() => window.polishTransitions.calls)).toBe(4)
		await expect(page.getByLabel('Amount', { exact: true })).toHaveCount(0)
		await expect(
			page.getByRole('main').getByRole('link', { name: /Transaction details:.*Polish expense/ })
		).toHaveCount(25)
		await page.goForward()
		await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
		await expect.poll(() => page.evaluate(() => window.polishTransitions.calls)).toBe(5)
		await page
			.getByRole('navigation', { name: 'Transaction pages', exact: true })
			.getByRole('link', { name: 'Page 2', exact: true })
			.click()
		await expect(page).toHaveURL((url) => url.searchParams.get('page') === '2')
		await expect.poll(() => page.evaluate(() => window.polishTransitions.calls)).toBe(5)
		await page.evaluate(() => {
			const link = document.createElement('a')
			link.href = `${location.pathname}${location.search}#verification`
			link.textContent = 'Verification fragment'
			document.body.append(link)
			link.click()
			link.remove()
		})
		await expect(page).toHaveURL((url) => url.hash === '#verification')
		expect(await page.evaluate(() => window.polishTransitions.calls)).toBe(5)
		await page.locator('aside').getByRole('link', { name: 'Categories', exact: true }).click()
		await expect(
			page.getByRole('main').getByRole('heading', { name: 'Categories', exact: true })
		).toBeVisible()
		expect(await page.evaluate(() => window.polishTransitions.calls)).toBe(5)
	}
)

for (const mode of ['reduced', 'unsupported', 'skipped', 'rejected'] satisfies (
	'reduced' | 'unsupported' | 'skipped' | 'rejected'
)[]) {
	test(
		`transaction navigation completes with ${mode} transitions`,
		{ tag: ['@transactions'] },
		async ({ page }) => {
			await trackTransitions(page, mode === 'unsupported')
			await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' })
			const fixture = await seed(page)
			await page.goto(`/expenses?workspace=${fixture.organizationId}`)
			await expect(
				page.getByRole('main').getByRole('link', { name: /Transaction details:.*Polish expense/ })
			).toHaveCount(25)
			if (mode === 'skipped' || mode === 'rejected')
				await page.evaluate((mode) => {
					window.polishTransitions.mode = mode
				}, mode)
			await page.getByRole('link', { name: 'Add Expenses', exact: true }).click()
			await expect(page).toHaveURL((url) => url.pathname === '/expenses/new')
			await expect(page.getByLabel('Amount', { exact: true })).toBeEnabled()
			expect(await page.evaluate(() => window.polishTransitions.calls)).toBe(
				mode === 'reduced' || mode === 'unsupported' ? 0 : 1
			)
		}
	)
}
