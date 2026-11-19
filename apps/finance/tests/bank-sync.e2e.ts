import { financeFixture } from './helpers/worker-fixture.js'
import { installWorkerFault } from './helpers/startup-failure.js'
import {
	holdWorkspaceWrite,
	machineErrors,
	ownRecoveryPhrase,
	requestRecovery
} from './helpers/workspace-drain.js'
import { pageContent } from './helpers/ui.js'
import { expect, test, type Page } from '@playwright/test'
import {
	openCreationModal,
	closeCreationModal,
	selectWorkspace,
	navigateSidebar,
	openSidebarSection
} from './helpers/ui.js'

async function syncLog(page: Page) {
	return financeFixture(page, 'bank-sync.e2e:18')
}

async function installPasskey(page: Page) {
	await page.addInitScript(() => {
		let assertions = 0
		class DemoCredential {
			rawId = new Uint8Array([1, 2, 3]).buffer
			getClientExtensionResults() {
				return { prf: { enabled: true, results: { first: new Uint8Array(32).fill(7).buffer } } }
			}
		}
		Object.defineProperty(window, 'PublicKeyCredential', {
			value: DemoCredential,
			configurable: true
		})
		Object.defineProperty(navigator, 'credentials', {
			configurable: true,
			value: {
				create: async () => new DemoCredential(),
				get: async () => {
					assertions += 1
					document.documentElement.dataset.assertions = String(assertions)
					return new DemoCredential()
				}
			}
		})
	})
}

async function connectResilienceBank(page: Page) {
	await installPasskey(page)
	await page.goto('/settings/banks')
	await page
		.getByLabel('SimpleFIN Bridge setup token', { exact: true })
		.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
	for (const name of [
		'Create Passkey',
		'Test encryption with my passkey',
		'Test unlocking with my passkey',
		'Connect and save securely'
	])
		await page.getByRole('button', { name, exact: true }).click()
	await expect(page.getByRole('button', { name: 'Discover Accounts', exact: true })).toBeEnabled()
}

function resilienceOperation(body: unknown) {
	if (
		!body ||
		typeof body !== 'object' ||
		!('operation' in body) ||
		(body.operation !== 'claim' && body.operation !== 'discover' && body.operation !== 'sync')
	)
		throw new Error('Invalid provider operation')
	return body.operation
}

test(
	'relay rejects cross-origin requests and unsafe destinations',
	{ tag: ['@bank-sync'] },
	async ({ request, baseURL }) => {
		if (!baseURL) throw new Error('Expected test base URL')
		const forbidden = await request.post('/api/simplefin', {
			headers: { Origin: 'https://evil.example' },
			data: { operation: 'claim', url: 'https://evil.example' }
		})
		expect(forbidden.status()).toBe(403)
		const rejected = await request.post('/api/simplefin', {
			headers: { Origin: baseURL },
			data: { operation: 'claim', url: 'https://evil.example' }
		})
		expect(rejected.status()).toBe(502)
		expect(await rejected.json()).toEqual({ error: 'provider-failure' })
		expect(rejected.headers()['cache-control']).toBe('no-store')
	}
)

test(
	'connects explicitly, creates provider-named accounts once, and imports idempotently',
	{ tag: ['@bank-sync'] },
	async ({ page, context }) => {
		test.setTimeout(120_000)
		await installPasskey(page)
		const operations: string[] = []
		let failSync = false
		const org = { 'sfin-url': 'https://bank.example', domain: 'bank.example' }
		const checking = {
			id: 'checking',
			name: 'Provider Checking',
			currency: 'USD',
			balance: '100.00',
			'available-balance': '90.00',
			'balance-date': 1792000000,
			org
		}
		const savings = {
			id: 'savings',
			name: 'Provider Savings',
			currency: 'USD',
			balance: '200.00',
			'balance-date': 1792000000,
			org
		}
		await page.context().route('**/api/simplefin', async (route) => {
			const body: unknown = route.request().postDataJSON()
			if (
				!body ||
				typeof body !== 'object' ||
				!('operation' in body) ||
				typeof body.operation !== 'string'
			)
				throw new Error('Invalid operation')
			operations.push(body.operation)
			if (body.operation === 'sync' && failSync) {
				await route.fulfill({ status: 502, json: { error: 'provider-failure' } })
				return
			}
			if (body.operation === 'claim') {
				await route.fulfill({
					contentType: 'text/plain',
					body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
				})
				return
			}
			await route.fulfill({
				json: {
					errors: [],
					accounts: [
						{
							...checking,
							transactions:
								body.operation === 'sync'
									? [
											{
												id: 'expense-1',
												amount: '-12.34',
												posted: 1792000000,
												description: 'Imported expense'
											},
											{
												id: 'income-1',
												amount: '100.00',
												posted: 1792000000,
												description: 'Imported income'
											},
											{
												id: 'pending-1',
												amount: '-1.00',
												posted: 1792000000,
												description: 'Pending',
												pending: true
											},
											{
												id: 'invalid-1',
												amount: '1.234',
												posted: 1792000000,
												description: 'Invalid precision'
											}
										]
									: undefined
						},
						savings
					]
				}
			})
		})
		await page.goto('/settings/banks')
		const input = page.locator('#simplefin-token')
		await expect(input).toBeVisible({ timeout: 30_000 })
		await expect(page.getByRole('button', { name: 'Discover Accounts', exact: true })).toHaveCount(
			0
		)
		await input.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
		await page.getByRole('button', { name: 'Create Passkey', exact: true }).click()
		await page.getByRole('button', { name: 'Test encryption with my passkey', exact: true }).click()
		await page.getByRole('button', { name: 'Test unlocking with my passkey', exact: true }).click()
		await expect(
			page.getByRole('button', { name: 'Connect and save securely', exact: true })
		).toBeVisible()
		expect(operations).toEqual([])
		await page.getByRole('button', { name: 'Connect and save securely', exact: true }).click()
		const discover = page.getByRole('button', { name: 'Discover Accounts', exact: true })
		await expect(discover).toBeEnabled()
		expect(operations).toEqual(['claim'])
		await discover.click()
		const addChecking = page.getByRole('button', {
			name: 'Add Account “Provider Checking”',
			exact: true
		})
		await expect(addChecking).toBeEnabled()
		await expect(
			page.getByRole('combobox', { name: 'Link to existing Account', exact: true })
		).toHaveCount(0)
		await addChecking.click()
		await expect(page.getByText('Linked to Provider Checking', { exact: true })).toBeVisible()
		await expect(addChecking).toHaveCount(0)
		// The first linked account must never become a destination for savings.
		await expect(
			page.getByRole('combobox', { name: 'Link to existing Account', exact: true })
		).toHaveCount(0)
		await page.getByRole('button', { name: 'Add Account “Provider Savings”', exact: true }).click()
		await expect(page.getByText('Linked to Provider Savings', { exact: true })).toBeVisible()
		await financeFixture(page, 'bank-sync.e2e:249')
		expect(await syncLog(page)).toEqual({ attempts: [], accounts: [] })
		const history = page.getByRole('region', { name: 'Sync history', exact: true })
		await expect(
			history.getByText('Showing locally available history.', { exact: false })
		).toHaveCount(0)
		await expect(
			history.getByText('No Sync history yet.', {
				exact: true
			})
		).toBeVisible()
		const sync = pageContent(page).getByRole('button', {
			name: 'Sync now (last 90 days)',
			exact: true
		})
		await sync.click()
		await expect(page.getByText(/Imported: 2; already present: 0; omitted: 2/)).toBeVisible()
		await expect(sync).toBeEnabled()
		const firstLog = await syncLog(page)
		expect(firstLog.attempts).toMatchObject([
			{
				outcome: 'partial',
				importedCount: 2,
				existingCount: 0,
				omittedCount: 2,
				importSettlement: 'locallyPersisted'
			}
		])
		expect(firstLog.accounts).toHaveLength(2)
		expect(firstLog.accounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					attemptId: firstLog.attempts[0]?.id,
					accountName: 'Provider Checking',
					outcome: 'partial',
					importedCount: 2,
					omittedCount: 2
				}),
				expect.objectContaining({
					attemptId: firstLog.attempts[0]?.id,
					accountName: 'Provider Savings',
					outcome: 'succeeded',
					importedCount: 0,
					omittedCount: 0
				})
			])
		)
		const firstAttempt = history.locator(':scope > details').first()
		await expect(history.locator(':scope > details')).toHaveCount(1)
		await firstAttempt.locator(':scope > summary').click()
		await expect(firstAttempt.getByText('Sync Operator', { exact: true })).toBeVisible()
		await expect(firstAttempt.getByText('Saved', { exact: true })).toBeVisible()
		const checkingResult = firstAttempt
			.locator('details')
			.filter({ has: page.locator('summary', { hasText: 'Provider Checking — Partial' }) })
		await checkingResult.locator('summary').click()
		await expect(checkingResult.locator('dd')).toHaveText(['2', '0', '2'])
		await expect(
			firstAttempt.locator('summary').filter({ hasText: 'Provider Savings — Succeeded' })
		).toBeVisible()
		const savedBalances = await financeFixture(page, 'bank-sync.e2e:324')
		expect(savedBalances).toHaveLength(2)
		expect(savedBalances).toEqual(
			expect.arrayContaining([
				{ availableBalance: '200.00', balanceDate: new Date(1792000000 * 1000).toISOString() },
				{ availableBalance: '90.00', balanceDate: new Date(1792000000 * 1000).toISOString() }
			])
		)
		const edited = await financeFixture(page, 'bank-sync.e2e:345')

		await sync.click()
		await expect(page.getByText(/Imported: 0; already present: 2; omitted: 2/)).toBeVisible()
		await expect(sync).toBeEnabled()
		expect((await syncLog(page)).attempts).toHaveLength(2)
		const afterRepeat = await financeFixture(page, 'bank-sync.e2e:370', edited.id)
		expect(afterRepeat).toEqual({
			count: 2,
			description: 'User description',
			memo: 'User notes',
			amountMinor: 5678,
			externalId: edited.externalId
		})

		expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
		await page.reload()
		await expect(discover).toBeEnabled()
		const savedHistory = pageContent(page).getByText(
			/Last sync:.*Imported: 0; already present: 2; omitted: 2/
		)
		await expect(savedHistory).toBeVisible()
		await expect(history.locator(':scope > details')).toHaveCount(2)
		await context.setOffline(true)
		await history.locator(':scope > details > summary').first().click()
		await expect(history.getByText('Sync Operator', { exact: true }).first()).toBeVisible()
		await expect(sync).toBeDisabled()
		await context.setOffline(false)
		await expect(sync).toBeEnabled()
		expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
		// A new discovery uses the current capability report without replacing saved sync history.
		await discover.click()
		await expect(page.getByText('Linked to Provider Checking', { exact: true })).toBeVisible()
		await expect(discover).toBeEnabled()
		await expect(savedHistory).toBeVisible()
		expect(operations).toEqual(['claim', 'discover', 'sync', 'sync', 'discover'])
		failSync = true
		await sync.click()
		await expect(
			pageContent(page)
				.getByRole('status')
				.filter({ hasText: 'SimpleFIN could not complete the request' })
		).toBeVisible()
		await expect(sync).toBeEnabled()
		expect(operations).toEqual(['claim', 'discover', 'sync', 'sync', 'discover', 'sync'])
		await expect(history.locator(':scope > details')).toHaveCount(3)
		const failedAttempt = history.locator(':scope > details').first()
		await expect(failedAttempt.locator(':scope > summary')).toContainText('Failed')
		await failedAttempt.locator(':scope > summary').click()
		await expect(failedAttempt.getByText('Unspecified', { exact: true })).toHaveCount(3)
		await expect(
			failedAttempt.getByText(
				'SimpleFIN could not complete the request. Check connectivity or reauthorize your accounts at SimpleFIN, then retry manually.',
				{ exact: true }
			)
		).toBeVisible()
		// Older records exercise pagination without issuing additional provider operations.
		const seededConnections = await financeFixture(page, 'bank-sync.e2e:438')
		await expect(history.locator(':scope > details')).toHaveCount(20)
		await history.getByRole('button', { name: 'More Sync history', exact: true }).click()
		await expect(history.locator(':scope > details')).toHaveCount(24)
		await expect(
			history.getByRole('button', { name: 'More Sync history', exact: true })
		).toHaveCount(0)
		await expect(history.locator(':scope > details > summary').last()).toContainText('Unspecified')
		const connectionSelector = history.getByRole('combobox', {
			name: 'Bank sync',
			exact: true
		})
		await connectionSelector.selectOption(seededConnections.other)
		await expect(history.locator(':scope > details')).toHaveCount(1)
		await expect(history.locator(':scope > details > summary')).toContainText('Unspecified')
		await connectionSelector.selectOption(seededConnections.current)
		await expect(history.locator(':scope > details')).toHaveCount(20)
		await page.setViewportSize({ width: 390, height: 844 })
		await expect(history).toBeVisible()
		expect(await history.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
			true
		)
		await page.reload()
		await expect(history.locator(':scope > details')).toHaveCount(20)
		expect(operations).toEqual(['claim', 'discover', 'sync', 'sync', 'discover', 'sync'])
		await page.goto(`/settings/workspace?workspace=${seededConnections.organizationId}`)
		const workspaceDialog = await openCreationModal(page, 'Create Workspace')
		await workspaceDialog
			.getByLabel('Workspace name', { exact: true })
			.fill('Unrelated bank history')
		await workspaceDialog.getByRole('button', { name: 'Create Workspace', exact: true }).click()
		await expect(
			workspaceDialog.getByRole('status').filter({ hasText: /^Workspace saved\.$/ })
		).toBeVisible()
		const workspaceLink = await page
			.getByRole('link', { name: 'Open Workspace: Unrelated bank history', exact: true })
			.getAttribute('href')
		if (!workspaceLink) throw new Error('Missing second workspace link')
		const secondWorkspaceId = new URL(workspaceLink, page.url()).searchParams.get('workspace')
		if (!secondWorkspaceId) throw new Error('Missing second workspace ID')
		await closeCreationModal(page)
		await page.goto(`/settings/banks?workspace=${secondWorkspaceId}`)
		await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
		await expect(history.locator('details')).toHaveCount(0)
		await expect(history.getByRole('combobox', { name: 'Bank sync', exact: true })).toHaveCount(0)
		await selectWorkspace(
			page.getByLabel('Current Workspace', { exact: true }),
			seededConnections.organizationId
		)
		const drawerToggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
		if ((await drawerToggle.getAttribute('aria-expanded')) === 'true') await drawerToggle.click()
		await expect(history.locator(':scope > details')).toHaveCount(20)
		await expect(discover).toBeEnabled()
		expect(operations).toEqual(['claim', 'discover', 'sync', 'sync', 'discover', 'sync'])
		await page.getByRole('button', { name: 'Disconnect Bank sync', exact: true }).click()
		await expect(discover).toHaveCount(0)
		await expect(sync).toHaveCount(0)
	}
)

test(
	'lock actor startup failure clears setup and allows an explicit new attempt',
	{ tag: ['@bank-sync'] },
	async ({ page }) => {
		const errors: string[] = []
		const stoppedActorWarnings: string[] = []
		page.on('console', (message) => {
			if (message.text().includes('sent to stopped actor'))
				stoppedActorWarnings.push(message.text())
		})
		const providerRequests: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))
		await installPasskey(page)
		await installWorkerFault(page, 'fail-bank-lock-once')
		await page.context().route('**/api/simplefin', async (route) => {
			providerRequests.push(route.request().url())
			await route.abort()
		})
		await page.goto('/settings/banks')
		const input = page.getByLabel('SimpleFIN Bridge setup token', { exact: true })
		const create = page.getByRole('button', { name: 'Create Passkey', exact: true })
		const token = btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token')
		await input.fill(token)
		await create.click()
		await expect(
			pageContent(page).getByRole('status').filter({ hasText: 'No automatic retry will occur' })
		).toBeVisible()
		await expect(input).toHaveValue('')
		await expect(create).toBeDisabled()
		await input.fill(token)
		await create.click()
		await expect(
			page.getByRole('button', { name: 'Test encryption with my passkey', exact: true })
		).toBeVisible()
		await page.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(input).toHaveValue('')
		expect(providerRequests).toEqual([])
		expect(errors).toEqual([])
		expect(stoppedActorWarnings).toEqual([])
	}
)

test(
	'cancelled passkey creation ignores a late success and releases the bank lock',
	{ tag: ['@bank-sync'] },
	async ({ page }) => {
		const errors: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))
		await installPasskey(page)
		await page.addInitScript(() => {
			const create = navigator.credentials.create.bind(navigator.credentials)
			let release: (() => void) | undefined
			let delayed = false
			document.addEventListener('release-test-passkey', () => release?.())
			Object.defineProperty(navigator.credentials, 'create', {
				configurable: true,
				value: async (options: CredentialCreationOptions) => {
					if (!delayed) {
						delayed = true
						document.documentElement.dataset.passkeyPending = 'true'
						await new Promise<void>((resolve) => {
							release = resolve
						})
					}
					const credential = await create(options)
					document.documentElement.dataset.passkeySettled = 'true'
					return credential
				}
			})
		})
		await page.goto('/settings/banks')
		const input = page.getByLabel('SimpleFIN Bridge setup token', { exact: true })
		const create = page.getByRole('button', { name: 'Create Passkey', exact: true })
		const encrypt = page.getByRole('button', {
			name: 'Test encryption with my passkey',
			exact: true
		})
		const token = btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token')
		await input.fill(token)
		await create.click()
		await expect(page.locator('html')).toHaveAttribute('data-passkey-pending', 'true')
		await page.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(input).toHaveValue('')
		await page.evaluate(() => document.dispatchEvent(new Event('release-test-passkey')))
		await expect(page.locator('html')).toHaveAttribute('data-passkey-settled', 'true')
		await expect(encrypt).toBeHidden()
		await input.fill(token)
		await create.click()
		await expect(encrypt).toBeVisible()
		await page.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(input).toHaveValue('')
		expect(errors).toEqual([])
	}
)

test(
	'maps and remaps a provider account to existing accounts without creating duplicates',
	{ tag: ['@bank-sync'] },
	async ({ page }) => {
		await installPasskey(page)
		await page.goto('/accounts')
		for (const name of ['Existing checking', 'Replacement checking']) {
			const dialog = await openCreationModal(page, 'Add Account')
			await dialog.getByLabel('Account name', { exact: true }).fill(name)
			await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
			await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
			await expect(dialog.getByRole('status')).toContainText(name)
			await dialog.getByRole('button', { name: 'Close', exact: true }).click()
			await expect(dialog).toBeHidden()
		}
		const operations: string[] = []
		await page.context().route('**/api/simplefin', async (route) => {
			const body: unknown = route.request().postDataJSON()
			if (
				!body ||
				typeof body !== 'object' ||
				!('operation' in body) ||
				typeof body.operation !== 'string'
			)
				throw new Error('Invalid provider command')
			operations.push(body.operation)
			if (body.operation === 'claim') {
				await route.fulfill({
					contentType: 'text/plain',
					body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
				})
				return
			}
			await route.fulfill({
				json: {
					errors: [],
					accounts: [
						{
							id: 'existing-checking',
							name: 'Provider Checking',
							currency: 'USD',
							org: { domain: 'bank.example', 'sfin-url': 'https://bank.example' }
						}
					]
				}
			})
		})
		await page.goto('/settings/banks')
		await page
			.getByLabel('SimpleFIN Bridge setup token', { exact: true })
			.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
		for (const name of [
			'Create Passkey',
			'Test encryption with my passkey',
			'Test unlocking with my passkey',
			'Connect and save securely'
		]) {
			await page.getByRole('button', { name, exact: true }).click()
		}
		const discover = page.getByRole('button', { name: 'Discover Accounts', exact: true })
		await expect(discover).toBeEnabled()
		await discover.click()
		const row = pageContent(page).getByRole('listitem').filter({ hasText: 'Provider Checking' })
		const existing = row.getByRole('combobox', {
			name: 'Link to existing Account',
			exact: true
		})
		await existing.selectOption({ label: 'Existing checking' })
		await expect(row.getByText('Linked to Existing checking', { exact: true })).toBeVisible()
		await expect(
			row.getByRole('button', { name: 'Add Account “Provider Checking”', exact: true })
		).toHaveCount(0)
		await existing.selectOption({ label: 'Replacement checking' })
		await expect(row.getByText('Linked to Replacement checking', { exact: true })).toBeVisible()
		expect(operations).toEqual(['claim', 'discover'])
		await page.reload()
		await expect(discover).toBeEnabled()
		expect(operations).toEqual(['claim', 'discover'])
		await discover.click()
		await expect(row.getByText('Linked to Replacement checking', { exact: true })).toBeVisible()
		expect(operations).toEqual(['claim', 'discover', 'discover'])
		await page.goto('/accounts')
		const table = page.getByRole('table', { name: 'Accounts', exact: true })
		await expect(table.getByRole('row')).toHaveCount(3)
		await expect(table.getByRole('cell', { name: 'Existing checking', exact: true })).toBeVisible()
		await expect(
			table.getByRole('cell', { name: 'Replacement checking', exact: true })
		).toBeVisible()
		const checkingRow = table.getByRole('row').filter({ hasText: 'Replacement checking' })
		await expect(checkingRow.getByRole('cell').nth(3)).toHaveText('$0.00')
	}
)

test(
	'cancels a pending sync, ignores its late response, and imports only on a new explicit sync',
	{ tag: ['@bank-sync'] },
	async ({ page }) => {
		await installPasskey(page)
		const operations: string[] = []
		const pending = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const completed = Promise.withResolvers<void>()
		let syncs = 0
		await page.context().route('**/api/simplefin', async (route) => {
			const body: unknown = route.request().postDataJSON()
			if (
				!body ||
				typeof body !== 'object' ||
				!('operation' in body) ||
				typeof body.operation !== 'string'
			)
				throw new Error('Invalid provider command')
			operations.push(body.operation)
			if (body.operation === 'claim') {
				await route.fulfill({
					contentType: 'text/plain',
					body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
				})
				return
			}
			const sync = body.operation === 'sync'
			if (sync) syncs += 1
			const delayed = sync && syncs === 1
			if (delayed) {
				pending.resolve()
				await release.promise
			}
			await route.fulfill({
				json: {
					errors: [],
					accounts: [
						{
							id: 'cancelled-checking',
							name: 'Cancelled Checking',
							currency: 'USD',
							org: { domain: 'bank.example', 'sfin-url': 'https://bank.example' },
							transactions: sync
								? [
										{
											id: 'cancelled-expense',
											amount: '-12.34',
											posted: 1792000000,
											description: 'Cancelled provider expense'
										}
									]
								: []
						}
					]
				}
			})
			if (delayed) completed.resolve()
		})
		await page.goto('/settings/banks')
		await page
			.getByLabel('SimpleFIN Bridge setup token', { exact: true })
			.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
		for (const name of [
			'Create Passkey',
			'Test encryption with my passkey',
			'Test unlocking with my passkey',
			'Connect and save securely'
		]) {
			await page.getByRole('button', { name, exact: true }).click()
		}
		const discover = page.getByRole('button', { name: 'Discover Accounts', exact: true })
		await discover.click()
		await page
			.getByRole('button', { name: 'Add Account “Cancelled Checking”', exact: true })
			.click()
		await expect(page.getByText('Linked to Cancelled Checking', { exact: true })).toBeVisible()
		const main = pageContent(page)
		const sync = main.getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
		await sync.click()
		await pending.promise
		await main.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(sync).toBeEnabled()
		release.resolve()
		expect((await syncLog(page)).attempts).toMatchObject([
			{
				outcome: 'cancelled',
				importSettlement: 'notStarted',
				importedCount: null,
				existingCount: null,
				omittedCount: null
			}
		])
		const history = page.getByRole('region', { name: 'Sync history', exact: true })
		await expect(history.locator(':scope > details > summary')).toContainText(
			'The request was cancelled.'
		)
		await history.locator(':scope > details > summary').click()
		await expect(history.getByText('not completed', { exact: true })).toBeVisible()
		await expect(history.getByText('Unspecified', { exact: true })).toHaveCount(3)
		await completed.promise
		expect(operations).toEqual(['claim', 'discover', 'sync'])
		await expect(main.getByText(/Imported:/)).toHaveCount(0)
		await sync.click()
		await expect(main.getByText(/Imported: 1; already present: 0; omitted: 0/)).toBeVisible()
		expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
		await page.reload()
		await expect(discover).toBeEnabled()
		expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
	}
)

for (const failure of ['start', 'result']) {
	test(
		`reports ${failure} log persistence failure separately from provider/import work`,
		{ tag: ['@bank-sync'] },
		async ({ page }) => {
			await installPasskey(page)
			const operations: string[] = []
			await page.context().route('**/api/simplefin', async (route) => {
				const body: unknown = route.request().postDataJSON()
				if (
					!body ||
					typeof body !== 'object' ||
					!('operation' in body) ||
					typeof body.operation !== 'string'
				)
					throw new Error('Invalid provider operation')
				operations.push(body.operation)
				if (body.operation === 'claim')
					await route.fulfill({
						contentType: 'text/plain',
						body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
					})
				else
					await route.fulfill({
						json: {
							errors: [],
							accounts: [
								{
									id: 'log-failure-checking',
									name: 'Log Failure Checking',
									currency: 'USD',
									org: { domain: 'bank.example', 'sfin-url': 'https://bank.example' },
									transactions:
										body.operation === 'sync'
											? [
													{
														id: 'log-failure-expense',
														amount: '-12.34',
														posted: 1792000000,
														description: 'Import despite logging failure'
													}
												]
											: []
								}
							]
						}
					})
			})
			await page.goto('/settings/banks')
			await page
				.getByLabel('SimpleFIN Bridge setup token', { exact: true })
				.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
			for (const name of [
				'Create Passkey',
				'Test encryption with my passkey',
				'Test unlocking with my passkey',
				'Connect and save securely'
			])
				await page.getByRole('button', { name, exact: true }).click()
			const sync = pageContent(page).getByRole('button', {
				name: 'Sync now (last 90 days)',
				exact: true
			})
			await expect(sync).toBeEnabled()
			await page.getByRole('button', { name: 'Discover Accounts', exact: true }).click()
			await page
				.getByRole('button', { name: 'Add Account “Log Failure Checking”', exact: true })
				.click()
			await expect(page.getByText('Linked to Log Failure Checking', { exact: true })).toBeVisible()

			await financeFixture(page, 'bank-sync.e2e:960', failure)
			await sync.click()
			const main = pageContent(page)

			await expect(
				main.getByText(
					'The sync ended, but its final log details could not be saved. The import result shown still applies.',
					{ exact: true }
				)
			).toBeVisible()
			await expect(
				main.getByText(
					/Last sync:.*Outcome: Succeeded\. Imported: 1; already present: 0; omitted: 0/
				)
			).toBeVisible()
			expect(operations).toEqual(['claim', 'discover', 'sync'])
			const imported = await financeFixture(page, 'bank-sync.e2e:998')
			expect(imported).toBe(1)
			if (failure === 'start') {
				expect((await syncLog(page)).attempts).toHaveLength(0)
			} else {
				expect((await syncLog(page)).attempts).toMatchObject([{ outcome: 'unfinished' }])
				await expect(
					page
						.getByRole('region', { name: 'Sync history', exact: true })
						.locator(':scope > details > summary')
				).toContainText('Unspecified')
			}
			await expect(sync).toBeEnabled()
		}
	)
}

test(
	'retention follows the synced connection while another connection history is selected',
	{ tag: ['@bank-sync'] },
	async ({ page }) => {
		const providerRequests: string[] = []
		await page.context().route('**/api/simplefin', async (route) => {
			const body: unknown = route.request().postDataJSON()
			if (
				!body ||
				typeof body !== 'object' ||
				!('operation' in body) ||
				typeof body.operation !== 'string'
			)
				throw new Error('Invalid provider operation')
			providerRequests.push(body.operation)
			if (body.operation === 'claim')
				await route.fulfill({
					contentType: 'text/plain',
					body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
				})
			else await route.fulfill({ json: { errors: [], accounts: [] } })
		})
		await installPasskey(page)
		await page.goto('/settings/banks')
		await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
		await page
			.getByLabel('SimpleFIN Bridge setup token', { exact: true })
			.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
		for (const name of [
			'Create Passkey',
			'Test encryption with my passkey',
			'Test unlocking with my passkey',
			'Connect and save securely'
		])
			await page.getByRole('button', { name, exact: true }).click()
		await expect(
			pageContent(page).getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
		).toBeEnabled()
		const organizationId = new URL(page.url()).searchParams.get('workspace')
		if (!organizationId) throw new Error('Missing workspace scope')
		const seeded = await financeFixture(page, 'bank-sync.e2e:1066', organizationId)
		await page.reload()
		await expect(page.getByRole('region', { name: 'Sync history', exact: true })).toBeVisible()
		await expect.poll(async () => (await syncLog(page)).attempts.length).toBe(102)
		const retained = await syncLog(page)
		expect(retained.attempts.filter((row) => row.outcome === 'succeeded')).toHaveLength(100)
		expect(retained.attempts.some((row) => row.id === seeded.oldest)).toBe(false)
		expect(retained.attempts.some((row) => row.id === seeded.unfinished)).toBe(true)
		expect(retained.attempts.some((row) => row.id === seeded.otherAttempt)).toBe(true)
		expect(retained.accounts).toHaveLength(0)
		expect(providerRequests).toEqual(['claim'])
		const history = page.getByRole('region', { name: 'Sync history', exact: true })
		await history
			.getByRole('combobox', { name: 'Bank sync', exact: true })
			.selectOption(seeded.otherConnectionId)
		await expect(history.locator(':scope > details')).toHaveCount(1)
		const sync = pageContent(page).getByRole('button', {
			name: 'Sync now (last 90 days)',
			exact: true
		})
		await sync.click()
		await expect(pageContent(page).getByText(/Last sync:.*Outcome: Succeeded/)).toBeVisible()
		await expect(sync).toBeEnabled()
		await expect
			.poll(async () => {
				const log = await syncLog(page)
				return log.attempts.filter(
					(row) => row.connectionId === seeded.connectionId && row.outcome !== 'unfinished'
				).length
			})
			.toBe(100)
		const afterSync = await syncLog(page)
		expect(afterSync.attempts).toHaveLength(102)
		expect(afterSync.attempts.some((row) => row.id === seeded.otherAttempt)).toBe(true)
		await expect(history.getByRole('combobox', { name: 'Bank sync', exact: true })).toHaveValue(
			seeded.otherConnectionId
		)
		await expect(history.locator(':scope > details')).toHaveCount(1)
		expect(providerRequests).toEqual(['claim', 'sync'])
	}
)

test(
	'saved bank history remains readable when the optional profile lookup fails',
	{ tag: ['@bank-sync'] },
	async ({ page }) => {
		await installPasskey(page)
		const operations: string[] = []
		await page.context().route('**/api/simplefin', async (route) => {
			const body: unknown = route.request().postDataJSON()
			if (
				!body ||
				typeof body !== 'object' ||
				!('operation' in body) ||
				typeof body.operation !== 'string'
			)
				throw new Error('Invalid provider operation')
			operations.push(body.operation)
			if (body.operation === 'claim')
				await route.fulfill({
					contentType: 'text/plain',
					body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
				})
			else await route.fulfill({ json: { errors: [], accounts: [] } })
		})
		await page.goto('/settings/banks')
		await page
			.getByLabel('SimpleFIN Bridge setup token', { exact: true })
			.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
		for (const name of [
			'Create Passkey',
			'Test encryption with my passkey',
			'Test unlocking with my passkey',
			'Connect and save securely'
		])
			await page.getByRole('button', { name, exact: true }).click()
		const sync = pageContent(page).getByRole('button', {
			name: 'Sync now (last 90 days)',
			exact: true
		})
		await expect(sync).toBeEnabled()
		await sync.click()
		await expect(pageContent(page).getByText(/Last sync:.*Outcome: Succeeded/)).toBeVisible()
		await expect(sync).toBeEnabled()
		const history = page.getByRole('region', { name: 'Sync history', exact: true })
		await expect(history.locator(':scope > details')).toHaveCount(1)
		await navigateSidebar(page, 'Accounts')
		await expect(history).toHaveCount(0)
		await financeFixture(page, 'bank-sync.e2e:1267')
		await openSidebarSection(page, 'Settings')
		await navigateSidebar(page, 'Bank sync')
		await expect(page.locator('html')).toHaveAttribute('data-profile-lookup-failed', 'true')
		await expect(history.locator(':scope > details')).toHaveCount(1)
		await expect(history.getByRole('combobox', { name: 'Bank sync', exact: true })).toBeEnabled()
		await history.locator(':scope > details > summary').click()
		await expect(history.getByText('Unavailable', { exact: true })).toBeVisible()
		await expect(history.getByText('Succeeded', { exact: true })).toBeVisible()
		for (const name of ['Imported', 'Already present', 'Omitted'])
			await expect(
				history
					.locator('dt')
					.filter({ hasText: new RegExp(`^${name}$`) })
					.locator('xpath=following-sibling::dd[1]')
			).toHaveText('0')
		expect(operations).toEqual(['claim', 'sync'])
	}
)

for (const interruption of ['switch', 'recover'] satisfies ('switch' | 'recover')[]) {
	test(
		`retains an issued bank import write through workspace ${interruption}`,
		{ tag: ['@bank-sync'] },
		async ({ page }) => {
			const errors = machineErrors(page)
			await installPasskey(page)
			const operations: string[] = []
			await page.context().route('**/api/simplefin', async (route) => {
				const body: unknown = route.request().postDataJSON()
				if (
					!body ||
					typeof body !== 'object' ||
					!('operation' in body) ||
					typeof body.operation !== 'string'
				)
					throw new Error('Invalid provider command')
				operations.push(body.operation)
				if (body.operation === 'claim') {
					await route.fulfill({
						contentType: 'text/plain',
						body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
					})
					return
				}
				await route.fulfill({
					json: {
						errors: [],
						accounts: [
							{
								id: 'held-write-account',
								name: 'Held write checking',
								currency: 'USD',
								org: { domain: 'bank.example', 'sfin-url': 'https://bank.example' },
								transactions:
									body.operation === 'sync'
										? [
												{
													id: 'held-write-expense',
													amount: '-12.34',
													posted: 1792000000,
													description: 'Held import write'
												}
											]
										: []
							}
						]
					}
				})
			})
			await page.goto('/settings/banks')
			await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
			const source = new URL(page.url()).searchParams.get('workspace')
			if (!source) throw new Error('Missing source workspace')
			let destination = ''
			let phrase = ''
			if (interruption === 'switch') {
				await navigateSidebar(page, 'Workspaces')
				const dialog = await openCreationModal(page, 'Create Workspace')
				await dialog.getByLabel('Workspace name', { exact: true }).fill('Bank drain destination')
				await dialog.getByRole('button', { name: 'Create Workspace', exact: true }).click()
				await expect(dialog.getByRole('status')).toHaveText('Workspace saved.')
				const href = await page
					.getByRole('link', { name: 'Open Workspace: Bank drain destination', exact: true })
					.getAttribute('href')
				if (!href) throw new Error('Missing destination')
				destination = new URL(href, page.url()).searchParams.get('workspace') ?? ''
				await closeCreationModal(page)
			} else phrase = await ownRecoveryPhrase(page)
			await page.goto(`/settings/banks?workspace=${source}`)
			await page
				.getByLabel('SimpleFIN Bridge setup token', { exact: true })
				.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
			for (const name of [
				'Create Passkey',
				'Test encryption with my passkey',
				'Test unlocking with my passkey',
				'Connect and save securely'
			])
				await page.getByRole('button', { name, exact: true }).click()
			await page.getByRole('button', { name: 'Discover Accounts', exact: true }).click()
			await page
				.getByRole('button', { name: 'Add Account “Held write checking”', exact: true })
				.click()
			await expect(page.getByText('Linked to Held write checking', { exact: true })).toBeVisible()
			const gate = await holdWorkspaceWrite(page, 'bank')
			try {
				await pageContent(page)
					.getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
					.click()
				await expect.poll(() => gate.status().then((value) => value.started)).toBe(true)
				if (interruption === 'switch') {
					await selectWorkspace(page.getByLabel('Current Workspace', { exact: true }), destination)
					await expect(page).toHaveURL(`/settings/banks?workspace=${destination}`)
					await expect(
						page.getByLabel('SimpleFIN Bridge setup token', { exact: true })
					).toHaveCount(0)
				} else {
					await requestRecovery(page, phrase)
					expect(await gate.status().then((value) => value.restores)).toBe(0)
				}
				await gate.release()
				if (interruption === 'switch')
					await expect(
						page.getByLabel('SimpleFIN Bridge setup token', { exact: true })
					).toBeVisible()
				else {
					await expect.poll(() => gate.status().then((value) => value.restores)).toBe(1)
					await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(source)
				}
				await expect
					.poll(async () => (await syncLog(page)).attempts)
					.toMatchObject([{ outcome: 'cancelled', importSettlement: 'locallyPersisted' }])
				const rows = await financeFixture(page, 'bank-sync.e2e:1428')
				expect(rows).toEqual([{ organizationId: source, description: 'Held import write' }])
				expect(operations).toEqual(['claim', 'discover', 'sync'])
				expect(errors).toEqual([])
			} finally {
				await gate.restore()
			}
		}
	)
}

test(
	'keeps the provider worker alive across navigation and avoids per-row reads on a 225-row repeat sync',
	{ tag: ['@bank-sync'] },
	async ({ page, context }) => {
		const errors = machineErrors(page)

		const pending = Promise.withResolvers<void>(),
			release = Promise.withResolvers<void>()
		const operations: string[] = []
		let syncCount = 0
		const provider = {
			id: 'resilient-checking',
			name: 'Resilient Checking',
			currency: 'USD',
			org: { 'sfin-url': 'https://bank.example', domain: 'bank.example' }
		}
		const transactions = Array.from({ length: 226 }, (_, i) => ({
			id: `resilience-${i}`,
			amount: '-1.00',
			posted: 1792000000,
			description: `Resilient transaction ${i}`
		}))
		await context.route('**/api/simplefin', async (route) => {
			const operation = resilienceOperation(route.request().postDataJSON())
			operations.push(operation)
			if (operation === 'claim') {
				await route.fulfill({
					contentType: 'text/plain',
					body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
				})
				return
			}
			if (operation === 'sync' && ++syncCount === 1) {
				pending.resolve()
				await release.promise
			}
			await route.fulfill({
				json: {
					errors: [],
					accounts: [{ ...provider, transactions: operation === 'sync' ? transactions : [] }]
				}
			})
		})
		await connectResilienceBank(page)
		await page.getByRole('button', { name: 'Discover Accounts', exact: true }).click()
		await page
			.getByRole('button', { name: 'Add Account “Resilient Checking”', exact: true })
			.click()
		await expect(page.getByText('Linked to Resilient Checking', { exact: true })).toBeVisible()
		await financeFixture(page, 'bank-sync.e2e:1509', { provider, transactions })
		const sync = pageContent(page).getByRole('button', {
			name: 'Sync now (last 90 days)',
			exact: true
		})
		await sync.click()
		await pending.promise
		await expect
			.poll(async () => (await financeFixture(page, 'providerWorkerStatus')).closed)
			.toBe(1)
		await navigateSidebar(page, 'Accounts')
		await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
		await expect(
			page.locator('aside').getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
		).toBeDisabled()
		expect((await financeFixture(page, 'providerWorkerStatus')).created).toBe(2)
		expect((await financeFixture(page, 'providerWorkerStatus')).closed).toBe(1)
		release.resolve()
		await expect
			.poll(async () => (await syncLog(page)).attempts)
			.toMatchObject([{ outcome: 'succeeded', importedCount: 1, existingCount: 225 }])
		await expect
			.poll(async () => (await financeFixture(page, 'providerWorkerStatus')).closed)
			.toBe(2)
		await openSidebarSection(page, 'Settings')
		await navigateSidebar(page, 'Bank sync')
		await expect(sync).toBeEnabled()
		await financeFixture(page, 'installReadMetrics')
		try {
			const started = performance.now()
			await sync.click()
			await expect(
				pageContent(page).getByText(/Imported: 0; already present: 226; omitted: 0/)
			).toBeVisible()
			const durationMs = Math.round(performance.now() - started)
			const queries = await financeFixture(page, 'readMetrics')
			expect(queries).toBeLessThan(30)
			await test.info().attach('repeat-sync-measurement', {
				body: JSON.stringify({ durationMs, existing: 226, queries }),
				contentType: 'application/json'
			})
			await expect
				.poll(async () => (await financeFixture(page, 'providerWorkerStatus')).closed)
				.toBe(3)
			const newest = page
				.getByRole('region', { name: 'Sync history', exact: true })
				.locator(':scope > details')
				.first()
			await expect(newest.locator(':scope > summary')).toContainText('Succeeded')
			await newest.locator(':scope > summary').click()
			await expect(newest.getByText('not completed', { exact: true })).toHaveCount(0)
			await expect(newest.getByText('Succeeded', { exact: true })).toBeVisible()
			expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
			expect(errors).toEqual([])
		} finally {
			await financeFixture(page, 'restoreReadMetrics')
		}
	}
)

for (const failure of ['http', 'json', 'schema', 'bootstrap', 'reply'] satisfies (
	'http' | 'json' | 'schema' | 'bootstrap' | 'reply'
)[]) {
	test(
		`provider worker ${failure} failure ends cleanly and never retries automatically`,
		{ tag: ['@bank-sync'] },
		async ({ page, context }) => {
			const operations: string[] = []

			await context.route('**/api/simplefin', async (route) => {
				const operation = resilienceOperation(route.request().postDataJSON())
				operations.push(operation)
				if (operation === 'claim')
					await route.fulfill({
						contentType: 'text/plain',
						body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
					})
				else if (failure === 'http')
					await route.fulfill({ status: 502, json: { error: 'provider-failure' } })
				else if (failure === 'json')
					await route.fulfill({ contentType: 'application/json', body: 'not JSON' })
				else await route.fulfill({ json: { accounts: [{ id: 'missing-required-fields' }] } })
			})
			await connectResilienceBank(page)
			if (failure === 'bootstrap') await financeFixture(page, 'failProviderBootstrap')
			if (failure === 'reply') await financeFixture(page, 'failProviderReply')
			const sync = pageContent(page).getByRole('button', {
				name: 'Sync now (last 90 days)',
				exact: true
			})
			await sync.click()
			await expect(
				pageContent(page)
					.getByText(/SimpleFIN could not complete the request/)
					.first()
			).toBeVisible()
			await expect(sync).toBeEnabled()
			await expect
				.poll(async () => (await syncLog(page)).attempts)
				.toMatchObject([{ outcome: 'failed', importSettlement: 'notStarted' }])
			const expected =
				failure === 'bootstrap' || failure === 'reply' ? ['claim'] : ['claim', 'sync']
			expect(operations).toEqual(expected)
			await page.reload()
			await expect(sync).toBeEnabled()
			expect(operations).toEqual(expected)
		}
	)
}

test(
	'discovery keeps usable accounts available for linking when another institution fails',
	{ tag: ['@bank-sync'] },
	async ({ page }) => {
		const operations: string[] = []
		let errorsOnly = false
		await page.context().route('**/api/simplefin', async (route) => {
			const operation = resilienceOperation(route.request().postDataJSON())
			operations.push(operation)
			if (operation === 'claim') {
				await route.fulfill({ body: 'https://test:test@bridge.simplefin.org/simplefin' })
				return
			}
			await route.fulfill({
				json: {
					errors: ['A different institution is temporarily unavailable'],
					accounts: errorsOnly
						? []
						: [
								{
									id: 'available-checking',
									name: 'Available Checking',
									currency: 'USD',
									org: { 'sfin-url': 'https://bank.example' }
								}
							]
				}
			})
		})
		await connectResilienceBank(page)
		await page.getByRole('button', { name: 'Discover Accounts', exact: true }).click()
		await expect(
			page.getByRole('button', { name: 'Add Account “Available Checking”', exact: true })
		).toBeVisible()
		await expect(page.getByRole('status').filter({ hasText: 'provider errors' })).toBeVisible()
		expect(operations).toEqual(['claim', 'discover'])
		expect((await syncLog(page)).attempts).toEqual([])
		errorsOnly = true
		await page.getByRole('button', { name: 'Discover Accounts', exact: true }).click()
		await expect(
			page.getByRole('status').filter({ hasText: 'SimpleFIN could not complete the request' })
		).toBeVisible()
		expect(operations).toEqual(['claim', 'discover', 'discover'])
	}
)

test(
	'reconnects previously created accounts in one action after replacing a passkey',
	{ tag: ['@bank-sync'] },
	async ({ page }) => {
		const operations: string[] = []
		const accounts = ['Checking', 'Savings'].map((name) => ({
			id: name.toLowerCase(),
			name: `Reconnect ${name}`,
			currency: 'USD',
			org: { 'sfin-url': 'https://bank.example', domain: 'bank.example' }
		}))
		await page.context().route('**/api/simplefin', async (route) => {
			const operation = resilienceOperation(route.request().postDataJSON())
			operations.push(operation)
			if (operation === 'claim')
				await route.fulfill({ body: 'https://test:test@bridge.simplefin.org/simplefin' })
			else await route.fulfill({ json: { errors: [], accounts } })
		})
		await connectResilienceBank(page)
		await page.getByRole('button', { name: 'Discover Accounts', exact: true }).click()
		for (const account of accounts) {
			await page.getByRole('button', { name: `Add Account “${account.name}”`, exact: true }).click()
			await expect(page.getByText(`Linked to ${account.name}`, { exact: true })).toBeVisible()
		}
		const before = await financeFixture(page, 'bank-sync.e2e:1780')
		await page.getByRole('button', { name: 'Disconnect Bank sync', exact: true }).click()
		await expect(page.getByRole('button', { name: 'Create Passkey', exact: true })).toBeVisible()
		// Re-run setup with a different PRF credential; the original passkey cannot unlock this envelope.
		await page.evaluate(() => {
			class ReplacementCredential {
				rawId = new Uint8Array([4, 5, 6]).buffer
				getClientExtensionResults() {
					return { prf: { enabled: true, results: { first: new Uint8Array(32).fill(8).buffer } } }
				}
			}
			Object.defineProperty(window, 'PublicKeyCredential', {
				value: ReplacementCredential,
				configurable: true
			})
			Object.defineProperty(navigator, 'credentials', {
				configurable: true,
				value: {
					create: async () => new ReplacementCredential(),
					get: async () => new ReplacementCredential()
				}
			})
		})
		await page
			.getByLabel('SimpleFIN Bridge setup token', { exact: true })
			.fill(btoa('https://bridge.simplefin.org/simplefin/claim/replacement-token'))
		for (const name of [
			'Create Passkey',
			'Test encryption with my passkey',
			'Test unlocking with my passkey',
			'Connect and save securely'
		])
			await page.getByRole('button', { name, exact: true }).click()
		await page.getByRole('button', { name: 'Discover Accounts', exact: true }).click()
		await expect(page.getByText('Linked to Reconnect Savings', { exact: true })).toBeVisible()
		await page.getByRole('button', { name: 'Reconnect existing accounts', exact: true }).click()
		await expect(page.getByText('Linked to Renamed Checking', { exact: true })).toBeVisible()
		await expect(
			page.getByRole('button', { name: 'Reconnect existing accounts', exact: true })
		).toHaveCount(0)
		const after = await financeFixture(page, 'bank-sync.e2e:1843')
		expect(after.accountIds).toEqual(before.accountIds)
		expect(after.links).toHaveLength(2)
		expect(after.links).toEqual(expect.arrayContaining(before.retained))
		expect(after.transactions).toHaveLength(0)
		expect(operations).toEqual(['claim', 'discover', 'claim', 'discover'])
	}
)
