import { financeFixture } from './worker-fixture.js'
import { expect, type Page } from '@playwright/test'

export async function seedTransaction(
	page: Page,
	scenario:
		| 'manual'
		| 'imported'
		| 'imported-income'
		| 'archived'
		| 'viewer'
		| 'check'
		| 'expense-check'
		| 'transfer' = 'manual'
) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled({ timeout: 30_000 })
	return financeFixture(page, 'helpers/transactions:19', scenario)
}

export async function persisted(page: Page, id: string) {
	return financeFixture(page, 'helpers/transactions:172', id)
}
