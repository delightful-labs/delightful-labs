import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
})

test('clipped text remains available to accessible names and descriptions', async ({
	page
}) => {
	const section = page.getByRole('region', {
		name: 'LoadingSpinner',
		exact: true
	})
	const spinner = section.getByRole('status').nth(1)
	const button = section.getByRole('button', { name: 'Toggle loading preview' })

	// Verify a caller can reference supplementary text as a native description.
	const text = spinner.locator('span')
	await expect(text).toHaveText('Loading compact preview')
	await text.evaluate((element) => {
		element.id = 'test-loading-description'
	})
	await button.evaluate((element) => {
		element.setAttribute('aria-describedby', 'test-loading-description')
	})
	await expect(button).toHaveAccessibleDescription('Loading compact preview')
})

test('loading status keeps supplementary text clipped across visibility changes', async ({
	page
}) => {
	const section = page.getByRole('region', {
		name: 'LoadingSpinner',
		exact: true
	})
	const spinner = section.locator('#loading-state-preview')
	const toggle = section.getByRole('button', { name: 'Toggle loading preview' })
	await expect(spinner).toBeHidden()
	await toggle.click()
	await expect(spinner).toBeVisible()
	await expect(spinner).toMatchAriaSnapshot('- status: Loading preview content')

	await expect(toggle).toBeFocused()
	await toggle.press('Space')
	await expect(spinner).toBeHidden()
	await expect(toggle).toBeFocused()
})
