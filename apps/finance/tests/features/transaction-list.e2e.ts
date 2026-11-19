import { financeFixture } from '../helpers/worker-fixture.js'
import { expect } from '@playwright/test'
import { test, start } from '../helpers/workspace.js'
import { navigateSidebar, selectWorkspace } from '../helpers/ui.js'

test(
	'transaction list shows empty income and expense views',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await page.goto('/expenses')
		const main = page.getByRole('main')
		await expect(main.getByText('Your recent activity will appear here.')).toBeVisible()
		await expect(main.locator('section ul.entries').getByRole('listitem')).toHaveCount(0)
		await expect(main.getByRole('link', { name: 'Add Expenses' })).toHaveAttribute(
			'href',
			/^\/expenses\/new\?workspace=[\da-f-]+$/i
		)
		await navigateSidebar(page, 'Income')
		await expect(page).toHaveURL(/\/income\?workspace=[\da-f-]+$/i)
		await expect(main.getByText('Your recent activity will appear here.')).toBeVisible()
		await expect(main.getByRole('link', { name: 'Add Income' })).toHaveAttribute(
			'href',
			/^\/income\/new\?workspace=[\da-f-]+$/i
		)
		const addIncome = main.getByRole('link', { name: 'Add Income', exact: true })
		await addIncome.focus()
		await addIncome.press('Enter')
		await expect(page).toHaveURL(/\/income\/new\?workspace=[\da-f-]+$/i)
		await expect(main.getByRole('heading', { name: 'Add Income', exact: true })).toBeVisible()
	}
)

test(
	'transaction list follows kind, date order, account filters, and workspace selection',
	{ tag: ['@transactions', '@workspaces'] },
	async ({ page }) => {
		await start(page)
		const firstWorkspaceId = await page
			.getByLabel('Current Workspace', { exact: true })
			.inputValue()
		const fixture = await financeFixture(page, 'features/transaction-list.e2e:40', firstWorkspaceId)
		const navigation = page.getByRole('navigation')
		await navigation.getByRole('link', { name: 'Expenses', exact: true }).click()
		const main = page.getByRole('main')
		const memos = main
			.getByRole('listitem')
			.getByText(/^(Recent expense|Older expense|Salary|Business expense|Live expense)$/)
		await expect(memos).toHaveText(['Recent expense', 'Older expense'])
		await expect(
			main.locator('section ul.entries').getByRole('listitem').getByText('$12.34', { exact: true })
		).toHaveCount(2)
		await page.getByRole('checkbox', { name: 'Cash', exact: true }).uncheck()
		await expect(memos).toHaveText(['Older expense'])
		await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).check()
		await expect(memos).toHaveText(['Recent expense', 'Older expense'])
		await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).uncheck()
		await expect(main.getByText('Turn on an account to see its transactions.')).toBeVisible()
		await expect(main.locator('section ul.entries').getByRole('listitem')).toHaveCount(0)
		await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).check()
		await expect(memos).toHaveText(['Recent expense', 'Older expense'])
		await navigation.getByRole('link', { name: 'Income', exact: true }).click()
		await expect(memos).toHaveText(['Salary'])
		await navigation.getByRole('link', { name: 'Expenses', exact: true }).click()
		await expect(page).toHaveURL(/\/expenses(?:\?|$)/)
		await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).check()
		const selector = page.getByLabel('Current Workspace', { exact: true })
		await selectWorkspace(selector, fixture.secondWorkspaceId)
		await expect(memos).toHaveText(['Business expense'])
		await selectWorkspace(selector, firstWorkspaceId)
		await expect(memos).toHaveText(['Recent expense', 'Older expense'])
		await financeFixture(page, 'features/transaction-list.e2e:174', {
			organizationId: firstWorkspaceId,
			...fixture
		})
		await expect(memos).toHaveText(['Live expense', 'Recent expense', 'Older expense'])
		await page.reload()
		await expect(memos).toHaveText(['Live expense', 'Recent expense', 'Older expense'])
	}
)

test(
	'transaction list groups days, separates currency totals, and displays archived category/tag/account names',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const fixture = await financeFixture(page, 'features/transaction-list.e2e:205', organizationId)
		await navigateSidebar(page, 'Expenses')
		const main = page.getByRole('main')
		await expect(main.locator('time')).toHaveText(['Tue, Mar 10, 2026', 'Mon, Mar 9, 2026'])
		const day = main.getByRole('region', { name: 'Tue, Mar 10, 2026', exact: true })
		await expect(day.getByLabel('Daily total: $12.50', { exact: true })).toBeVisible()
		await expect(day.getByLabel('Daily total: TSh 3.00', { exact: true })).toBeVisible()
		await expect(day.getByRole('listitem')).toHaveCount(3)
		const first = day
			.getByRole('listitem')
			.filter({ has: page.getByText('First daily entry', { exact: true }) })
		await expect(first.getByText('Daily category', { exact: true })).toBeVisible()
		await expect(first.getByText('Historical tag', { exact: true })).toBeVisible()
		await expect(
			day.getByRole('listitem').filter({ hasText: '$2.50' }).getByRole('link')
		).toHaveAccessibleName('Transaction details: Daily category, $2.50')
		await page.getByRole('checkbox', { name: 'TZS account', exact: true }).uncheck()
		await expect(day.getByLabel('Daily total: TSh 3.00', { exact: true })).toHaveCount(0)
		await expect(day.getByLabel('Daily total: $12.50', { exact: true })).toBeVisible()
		await expect(day.getByRole('listitem')).toHaveCount(2)
		await financeFixture(page, 'features/transaction-list.e2e:318', fixture)
		await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).check()
		await expect(first.getByText('Renamed daily category', { exact: true })).toBeVisible()
		await expect(first.getByText('Renamed historical tag', { exact: true })).toBeVisible()
		await first.getByRole('link').click()
		const selectedAccount = main.getByLabel('Account', { exact: true }).locator('option:checked')
		await expect(selectedAccount).toHaveText('Renamed daily account · USD')
		await expect(selectedAccount).toBeDisabled()
		await navigateSidebar(page, 'Expenses')
		await page.reload()
		await expect(
			main.getByRole('region', { name: 'Tue, Mar 10, 2026', exact: true }).getByRole('listitem')
		).toHaveCount(3)
		await expect(first.getByText('Renamed historical tag', { exact: true })).toBeVisible()
	}
)
