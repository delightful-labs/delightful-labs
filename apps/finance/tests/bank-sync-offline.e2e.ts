import { expect, test } from '@playwright/test'

const setupMessage =
	'Bank sync setup is not available offline. Connect to the internet to continue.'
const syncMessage =
	'Sync is not available offline. Connect to the internet to sync your bank transactions.'

test(
	'offline setup replaces the stepper and idle prompt with a centered message and large icon',
	{ tag: ['@bank-sync'] },
	async ({ page, context }) => {
		await page.goto('/settings/banks')
		const token = page.getByLabel('SimpleFIN Bridge setup token', { exact: true })
		await expect(token).toBeVisible({ timeout: 30_000 })
		const main = page.getByRole('main')
		await expect(main.getByText('Enter setup token to begin.', { exact: true })).toBeVisible()
		await context.setOffline(true)
		const message = main.getByRole('status').filter({ hasText: setupMessage })
		await expect(message).toBeVisible()
		await expect(token).toBeHidden()
		await expect(main.getByText('Enter setup token to begin.', { exact: true })).toBeHidden()
		await expect(main.locator('ol')).toHaveCount(0)
		await expect(message).toHaveCSS('text-align', 'center')
		const icon = message.locator('svg')
		await expect(icon).toHaveAttribute('aria-hidden', 'true')
		await expect(icon).toHaveCSS('width', '96px')
		await expect(icon).toHaveCSS('height', '96px')
		const iconBox = await icon.boundingBox()
		const textBox = await message.locator('p').boundingBox()
		if (!iconBox || !textBox) throw new Error('Expected offline message geometry')
		expect(textBox.y).toBeGreaterThanOrEqual(iconBox.y + iconBox.height)
		expect(Math.abs(iconBox.x + iconBox.width / 2 - textBox.x - textBox.width / 2)).toBeLessThan(1)
		await context.setOffline(false)
		await expect(token).toBeVisible()
		await expect(message).toBeHidden()
		await expect(main.getByText('Enter setup token to begin.', { exact: true })).toBeVisible()
	}
)

test(
	'offline disables both sync buttons and reconnect setup; reconnecting makes no provider request',
	{ tag: ['@bank-sync'] },
	async ({ page, context }) => {
		await page.setViewportSize({ width: 1280, height: 900 })
		await page.addInitScript(() => {
			class TestCredential {
				rawId = new Uint8Array([1, 2, 3]).buffer
				getClientExtensionResults() {
					return { prf: { enabled: true, results: { first: new Uint8Array(32).fill(7).buffer } } }
				}
			}
			Object.defineProperty(window, 'PublicKeyCredential', {
				value: TestCredential,
				configurable: true
			})
			Object.defineProperty(navigator, 'credentials', {
				configurable: true,
				value: {
					create: async () => new TestCredential(),
					get: async () => new TestCredential()
				}
			})
		})
		const operations: unknown[] = []
		await page.context().route('**/api/simplefin', async (route) => {
			operations.push(route.request().postDataJSON())
			await route.fulfill({
				contentType: 'text/plain',
				body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
			})
		})
		await page.goto('/settings/banks')
		await page
			.getByLabel('SimpleFIN Bridge setup token', { exact: true })
			.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
		await page.getByRole('button', { name: 'Create Passkey', exact: true }).click()
		await page.getByRole('button', { name: 'Test encryption with my passkey', exact: true }).click()
		await page.getByRole('button', { name: 'Test unlocking with my passkey', exact: true }).click()
		await page.getByRole('button', { name: 'Connect and save securely', exact: true }).click()
		const sync = page.getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
		await expect(sync).toHaveCount(2)
		for (const button of await sync.all()) await expect(button).toBeEnabled()
		await page.getByText('Lost passkey?', { exact: true }).click()
		await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
		await context.setOffline(true)
		for (const button of await sync.all()) {
			await expect(button).toBeDisabled()
			await expect(button).toHaveAccessibleDescription(syncMessage)
		}
		await expect(page.getByText(syncMessage, { exact: true })).toHaveCount(2)
		await expect(page.getByText(setupMessage, { exact: true })).toBeVisible()
		await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeHidden()
		expect(operations).toHaveLength(1)
		await context.setOffline(false)
		for (const button of await sync.all()) await expect(button).toBeEnabled()
		await expect(page.getByText(syncMessage, { exact: true })).toHaveCount(0)
		await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
		expect(operations).toHaveLength(1)
	}
)
