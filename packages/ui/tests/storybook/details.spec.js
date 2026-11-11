import { expect, test } from '@playwright/test'

for (const story of ['inline', 'absolute', 'right-caret', 'custom-caret']) {
	test(`Details ${story} renders and toggles with the keyboard`, async ({
		page
	}) => {
		/** @type {string[]} */
		const errors = []
		page.on('pageerror', (error) => errors.push(error.message))
		await page.goto(
			`/iframe.html?id=disclosure-details--${story}&viewMode=story`
		)
		const details = page.locator('details')
		const summary = details.locator('summary')
		await expect(summary).toHaveText(/Options/)
		await expect(summary).toBeVisible()
		await expect(details).not.toHaveAttribute('open')
		if (story !== 'custom-caret') {
			await expect(summary.locator('svg')).toHaveAttribute(
				'viewBox',
				'0 0 24 24'
			)
		}
		await summary.focus()
		await summary.press('Enter')
		await expect(details).toHaveAttribute('open', '')
		if (story !== 'custom-caret') {
			await expect(summary.locator('svg')).toHaveAttribute(
				'viewBox',
				'0 0 24 24'
			)
		}
		if (story === 'absolute') {
			await expect(
				details.getByRole('link', { name: 'View options' })
			).toBeVisible()
		} else {
			await expect(details.getByText('Additional information.')).toBeVisible()
		}
		await summary.press('Space')
		await expect(details).not.toHaveAttribute('open')
		expect(errors).toEqual([])
	})
}
