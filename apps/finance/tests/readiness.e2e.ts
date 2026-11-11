import { expect, test } from '@playwright/test'

test('startup storage failure is recoverable by an explicit retry', async ({ page }) => {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.addInitScript(() => {
		const getItem = Storage.prototype.getItem
		let failed = false
		Storage.prototype.getItem = function (key) {
			if (!failed && key.startsWith('jazz-account-selection-v1:')) {
				failed = true
				throw new DOMException('Synthetic account storage failure', 'SecurityError')
			}
			return getItem.call(this, key)
		}
	})
	await page.goto('/settings/banks')
	await expect(page.getByText('Your finances could not be opened.', { exact: false })).toBeVisible()
	await page.getByRole('button', { name: 'Try again', exact: true }).click()
	await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
	await expect(page.getByText('Your finances could not be opened.', { exact: false })).toBeHidden()
	expect(errors).toEqual([])
})

test('opening / and reloading saved failed bank history causes no machine errors or provider requests', async ({
	page
}) => {
	const errors: string[] = []
	const providerRequests: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error' && message.text().includes('[state-machine]'))
			errors.push(message.text())
	})
	await page.route('**/api/simplefin', async (route) => {
		providerRequests.push(route.request().postData() ?? '')
		await route.fulfill({ status: 502, json: { error: 'Unexpected automatic provider request' } })
	})
	await page.goto('/')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Overview', exact: true })
	).toBeVisible()
	const organizationId = new URL(page.url()).searchParams.get('workspace')
	if (!organizationId) throw new Error('Expected scoped workspace after startup')
	await page.evaluate(async (organizationId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const session = getCurrentJazzSession()?.getSnapshot()
		if (!session?.client || !session.account) throw new Error('Expected initialized session')
		await session.client.db
			.insert(app.simplefinConnections, {
				organizationId,
				ownerId: session.account.id,
				accessUrl: '',
				status: 'active',
				credentialVersion: 1,
				credentialId: 'synthetic-credential',
				ciphertext: 'synthetic-ciphertext',
				prfSalt: 'synthetic-salt',
				iv: 'synthetic-iv',
				claimedAt: new Date(),
				lastSyncAt: new Date(),
				lastOutcome: 'failed',
				lastError: 'operation-failed',
				importedCount: 0,
				existingCount: 0,
				omittedCount: 0
			})
			.wait({ tier: 'local' })
	}, organizationId)
	await page.goto(`/settings/banks?workspace=${organizationId}`)
	const history = page.getByRole('main').getByText(/Last sync: .*Outcome: Failed\./)
	await expect(history).toBeVisible()
	await page.reload()
	await expect(history).toBeVisible()
	const syncButtons = page
		.getByRole('main')
		.getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
	await expect(syncButtons).toHaveCount(2)
	for (const button of await syncButtons.all()) await expect(button).toBeEnabled()
	expect(providerRequests).toEqual([])
	expect(errors).toEqual([])
})
