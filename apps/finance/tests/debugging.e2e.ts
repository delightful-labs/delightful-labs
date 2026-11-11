import { expect, test } from '@playwright/test'
import { openCreationModal } from './helpers/ui.js'

declare global {
	interface Window {
		debugFixture: { opens: number; messages: unknown[]; disconnects: number }
	}
}

test.beforeEach(async ({ page, context }) => {
	// Use a real cross-origin popup/handshake, with a local test receiver.
	await context.route('https://stately.ai/**', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: `<!doctype html><title>Inspector test receiver</title><script>
			addEventListener('message', ({ data }) => opener.postMessage({ type: 'test:inspection', event: data }, '*'));
			opener.postMessage({ type: '@statelyai.connected' }, '*');
		</script>`
		})
	)
	await page.addInitScript(() => {
		window.debugFixture = { opens: 0, messages: [], disconnects: 0 }
		const open = window.open.bind(window)
		window.open = (url, target, features) => {
			window.debugFixture.opens += 1
			return open(url, target, features)
		}
		window.addEventListener('message', ({ data: message }) => {
			const data = message?.type === 'test:inspection' ? message.event : message
			if (data?.type === '@statelyai.disconnected') window.debugFixture.disconnects += 1
			if (
				data &&
				typeof data === 'object' &&
				'type' in data &&
				typeof data.type === 'string' &&
				data.type.startsWith('@xstate.')
			)
				window.debugFixture.messages.push(data)
		})
	})
})

test('debug flag controls developer tools and sanitized state inspection', async ({
	page
}, info) => {
	const enabled = info.config.metadata.debugEnabled === true
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))

	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	const menu = page.getByRole('button', { name: 'Developer menu', exact: true })
	if (enabled) {
		await menu.focus()
		await menu.press('Enter')
		await expect(page.getByRole('dialog', { name: 'Developer menu', exact: true })).toBeVisible()
		expect(await page.evaluate(() => window.debugFixture.opens)).toBe(0)
		await page.getByRole('button', { name: 'Open Stately Inspector', exact: true }).click()
		await expect(
			page.getByRole('link', { name: 'Open Jazz inspector', exact: true })
		).toHaveAttribute('href', 'https://v2.inspector.jazz.tools/')
		await page.keyboard.press('Escape')
	} else {
		await expect(menu).toHaveCount(0)
	}
	await openCreationModal(page, 'Add Account')
	const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
	await dialog.getByLabel('Account name', { exact: true }).fill('PRIVATE_DEBUG_ACCOUNT')
	await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect(dialog.getByRole('status')).toContainText('PRIVATE_DEBUG_ACCOUNT')
	if (enabled) {
		await expect
			.poll(() => page.evaluate(() => window.debugFixture.messages.length))
			.toBeGreaterThan(0)
		const captured = await page.evaluate(() => JSON.stringify(window.debugFixture))
		expect(captured).not.toContain('PRIVATE_DEBUG_ACCOUNT')
		expect(captured).toContain('@xstate.actor')
		expect(captured).toContain('@xstate.snapshot')
		expect(captured).toContain('SUBMIT')
		expect(await page.evaluate(() => window.debugFixture.opens)).toBe(1)
		await page.keyboard.press('Escape')
		await menu.focus()
		await menu.press('Enter')
		const devDialog = page.getByRole('dialog', { name: 'Developer menu', exact: true })
		await devDialog
			.getByRole('button', { name: 'Add 25 sample Expense Transactions', exact: true })
			.click()
		await expect(devDialog.getByRole('status')).toHaveText('Saved 25 of 25 sample transactions.')
	} else {
		expect(await page.evaluate(() => window.debugFixture)).toEqual({
			opens: 0,
			messages: [],
			disconnects: 0
		})
	}
	expect(errors).toEqual([])
})

test('deployed debug build starts the inspector and developer menu', async ({ page }) => {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	const menu = page.getByRole('button', { name: 'Developer menu', exact: true })
	await menu.focus()
	await menu.press('Enter')
	await expect(page.getByRole('dialog', { name: 'Developer menu', exact: true })).toBeVisible()
	expect(await page.evaluate(() => window.debugFixture.opens)).toBe(0)
	await page.getByRole('button', { name: 'Open Stately Inspector', exact: true }).click()
	await expect
		.poll(() => page.evaluate(() => window.debugFixture.messages.length))
		.toBeGreaterThan(0)
	expect(await page.evaluate(() => window.debugFixture.opens)).toBe(1)
	expect(errors).toEqual([])
})

test('HMR replacement disconnects the old inspector and attaches the new module', async ({
	page
}, info) => {
	test.skip(info.config.metadata.debugEnabled !== true)
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	const menu = page.getByRole('button', { name: 'Developer menu', exact: true })
	await menu.focus()
	await menu.press('Enter')
	await page.getByRole('button', { name: 'Open Stately Inspector', exact: true }).click()
	await page.keyboard.press('Escape')
	await expect
		.poll(() => page.evaluate(() => window.debugFixture.messages.length))
		.toBeGreaterThan(0)
	const before = await page.evaluate(() => window.debugFixture.opens)
	const latestEvent = await page.evaluate(() => JSON.stringify(window.debugFixture.messages.at(-1)))
	expect(latestEvent).toBeDefined()
	await page.evaluate(async () => {
		const originalPath = '/src/lib/diagnostics/inspector.ts'
		const original: typeof import('../src/lib/diagnostics/inspector.js') = await import(
			originalPath
		)
		const clientPath = '/@vite/client'
		const { createHotContext }: { createHotContext: (path: string) => unknown } = await import(
			clientPath
		)
		const context = createHotContext('/__inspector_hmr_test__')
		if (
			!context ||
			typeof context !== 'object' ||
			!('accept' in context) ||
			typeof context.accept !== 'function' ||
			!('hmrClient' in context)
		)
			throw new Error('Vite HMR test driver is unavailable')
		const client = context.hmrClient
		if (
			!client ||
			typeof client !== 'object' ||
			!('queueUpdate' in client) ||
			typeof client.queueUpdate !== 'function'
		)
			throw new Error('Vite live update API is unavailable')
		context.accept('/src/lib/diagnostics/inspector.ts', () => {})
		const timestamp = Date.now()
		await client.queueUpdate({
			type: 'js-update',
			path: '/__inspector_hmr_test__',
			acceptedPath: '/src/lib/diagnostics/inspector.ts',
			timestamp
		})
		const inspectorPath = `/src/lib/diagnostics/inspector.ts?t=${timestamp}`
		const {
			inspectActor,
			openStateInspector
		}: typeof import('../src/lib/diagnostics/inspector.js') = await import(inspectorPath)
		const xstatePath = '/node_modules/.vite/deps/xstate.js'
		const { createActor, createMachine }: typeof import('xstate') = await import(xstatePath)
		const actor = createActor(
			createMachine({ id: 'hmr-fixture', initial: 'ready', states: { ready: {} } }),
			{ inspect: inspectActor }
		).start()
		actor.stop()
		openStateInspector()
		original.openStateInspector()
		const retired = createActor(createMachine({ id: 'retired-hmr-fixture' }), {
			inspect: original.inspectActor
		}).start()
		retired.stop()
	})
	await expect.poll(() => page.evaluate(() => window.debugFixture.disconnects)).toBe(1)
	await expect.poll(() => page.evaluate(() => window.debugFixture.opens)).toBe(before + 1)
	await expect
		.poll(() => page.evaluate(() => JSON.stringify(window.debugFixture.messages)))
		.toContain('hmr-fixture')
	const replayCount = await page.evaluate(
		(first) =>
			window.debugFixture.messages.filter((event) => JSON.stringify(event) === first).length,
		latestEvent
	)
	expect(replayCount, 'Disposed inspector must not reconnect and replay old events').toBe(1)
	expect(await page.evaluate(() => JSON.stringify(window.debugFixture.messages))).not.toContain(
		'retired-hmr-fixture'
	)
	expect(errors).toEqual([])
})

test('startup failure diagnostics follow the debug flag and preserve retry', async ({
	page
}, info) => {
	const diagnostics: string[] = []
	page.on('console', (message) => {
		if (message.type() === 'error' && /\[(?:state-machine|jazz-startup)\]/.test(message.text()))
			diagnostics.push(message.text())
	})
	await page.addInitScript(() => {
		const getItem = Storage.prototype.getItem
		let failed = false
		Storage.prototype.getItem = function (key) {
			if (!failed && key.startsWith('jazz-account-selection-v1:')) {
				failed = true
				throw new DOMException(
					'Synthetic account storage failure token=PRIVATE_STARTUP_TOKEN',
					'SecurityError'
				)
			}
			return getItem.call(this, key)
		}
	})
	await page.goto('/settings/banks')
	await expect(page.getByText('Your finances could not be opened.', { exact: false })).toBeVisible()
	if (info.config.metadata.debugEnabled === true) {
		await expect.poll(() => diagnostics.join('\n')).toContain('Machine entered an error state')
		expect(diagnostics.join('\n')).toContain('machine: application-readiness')
		expect(diagnostics.join('\n')).not.toContain('PRIVATE_STARTUP_TOKEN')
	} else {
		expect(diagnostics).toEqual([])
	}
	expect(await page.evaluate(() => window.debugFixture.opens)).toBe(0)
	await page.getByRole('button', { name: 'Try again', exact: true }).click()
	await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
})

test(
	'deployed debug build prepares fresh hosted Jazz workspaces',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		test.skip(process.env.JAZZ_HOSTED_PREVIEW_SMOKE !== 'true')
		const failures: string[] = []
		page.on('pageerror', (error) => failures.push(error.message))
		await page.goto('/accounts')
		await expect(
			page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
		).toBeVisible()
		await expect(
			page.getByText('Your workspaces could not be prepared.', { exact: false })
		).toHaveCount(0)
		await openCreationModal(page, 'Add Account')
		const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
		await dialog.getByLabel('Account name', { exact: true }).fill('Preview smoke account')
		await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
		await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText('Preview smoke account')
		expect(await page.evaluate(() => window.debugFixture.opens)).toBe(0)
		expect(failures).toEqual([])
	}
)

test('deployed debug build seeds fake accounts without duplicating on reload', async ({ page }) => {
	test.skip(
		process.env.JAZZ_HOSTED_PREVIEW_SMOKE !== 'true' || process.env.PUBLIC_FAKE_DATA !== 'true'
	)
	await page.goto('/accounts')
	const main = page.getByRole('main')
	await expect(main.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
	await expect(main.locator('tbody tr')).toHaveCount(3)
	const names = await main.locator('tbody tr td:first-child').allTextContents()
	await page.reload()
	await expect(main.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
	await expect(main.locator('tbody tr')).toHaveCount(3)
	expect(await main.locator('tbody tr td:first-child').allTextContents()).toEqual(names)
})
