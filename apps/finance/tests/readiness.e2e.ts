import { financeFixture } from './helpers/worker-fixture.js'
import { failNextAccountStorageOpen } from './helpers/startup-failure.js'
import { expect, test } from '@playwright/test'

test('startup storage failure is recoverable by an explicit retry', async ({ page }) => {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await failNextAccountStorageOpen(page)
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
	await financeFixture(page, 'readiness.e2e:45', organizationId)
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
