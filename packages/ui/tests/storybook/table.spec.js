import { expect, test } from '@playwright/test'

test('table keeps native headers, rows and actions', async ({ page }) => {
	await page.goto('/iframe.html?id=data-table--accounts&viewMode=story')
	const table = page.getByRole('table', { name: 'Accounts', exact: true })
	await expect(table).toBeVisible()
	await expect(table.getByRole('columnheader')).toHaveCount(4)
	await expect(table.getByRole('rowheader')).toHaveCount(2)

	await expect(
		table.getByRole('button', { name: 'Archive Personal checking' })
	).toBeEnabled()
})

test('narrow tables scroll locally with the keyboard and expose reachable row actions', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 700 })
	await page.goto(
		'/iframe.html?id=data-table--horizontal-overflow&viewMode=story'
	)
	const region = page.getByRole('region', { name: 'Accounts with details' })
	await expect(region).toBeVisible()
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth)
	).toBeLessThanOrEqual(320)
	await region.focus()
	await region.press('ArrowRight')
	await expect
		.poll(() => region.evaluate((element) => element.scrollLeft))
		.toBeGreaterThan(0)
	await region.press('Tab')
	await expect(
		page.getByRole('button', { name: 'Archive Personal checking' })
	).toBeFocused()
	const captionId = await page.locator('caption').getAttribute('id')
	if (!captionId) throw new Error('Expected a caption ID')
	await expect(region).toHaveAttribute('aria-labelledby', captionId)
})
