import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark', 'automatic-dark']) {
	test(`error alert remains accessible in ${theme}`, async ({ page }) => {
		await page.emulateMedia({
			colorScheme: theme === 'automatic-dark' ? 'dark' : 'light',
			reducedMotion: 'reduce'
		})
		await page.goto(
			'/iframe.html?id=feedback-statusmessage--error&viewMode=story'
		)
		await page.evaluate((theme) => {
			if (theme !== 'automatic-dark')
				document.documentElement.dataset.duiTheme = theme
		}, theme)
		const message = page.getByRole('alert')
		await expect(message).toBeVisible()
		await expect(message).toHaveText(
			'Could not save the transaction. Try again.'
		)
	})
}
