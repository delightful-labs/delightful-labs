import { expect, test } from '@playwright/test'

test(
	'category controls and creation remain usable after queries settle',
	{ tag: ['@categories'] },
	async ({ page }) => {
		await page.goto('/settings/categories')
		const main = page.getByRole('main')
		await expect(main.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible()
		await expect(main.getByRole('table', { name: 'Categories', exact: true })).toBeVisible()
		await expect(main.locator('[inert]')).toHaveCount(0)
		await main.getByRole('button', { name: 'Add Category', exact: true }).click()
		const dialog = page.getByRole('dialog', { name: 'Add Category', exact: true })
		await dialog.getByLabel('Category name', { exact: true }).fill('Loading regression category')
		await dialog.getByRole('button', { name: 'Add Category', exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText('Loading regression category')
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(
			main.getByRole('rowheader', { name: 'Loading regression category', exact: true })
		).toBeVisible()
		await page.reload()
		await expect(
			main.getByRole('rowheader', { name: 'Loading regression category', exact: true })
		).toBeVisible()
	}
)
