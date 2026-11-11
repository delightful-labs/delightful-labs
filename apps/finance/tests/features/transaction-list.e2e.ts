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
		const fixture = await page.evaluate(async (organizationId) => {
			const { app, db, userId } = window.workspaceSettingsTest
			const second = await db
				.insert(app.organizations, {
					name: 'Other transactions',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: userId
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.organizationMembers, {
					organizationId: second.id,
					userId,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
			const checking = await db
				.insert(app.accounts, { organizationId, name: 'Checking', kind: 'bank', currency: 'USD' })
				.wait({ tier: 'global' })
			const cash = await db
				.insert(app.accounts, { organizationId, name: 'Cash', kind: 'cash', currency: 'USD' })
				.wait({ tier: 'global' })
			const business = await db
				.insert(app.accounts, {
					organizationId: second.id,
					name: 'Business',
					kind: 'bank',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const expense = await db
				.insert(app.categories, {
					organizationId,
					name: 'Test expenses',
					kind: 'expense',
					isSystem: false
				})
				.wait({ tier: 'global' })
			const income = await db
				.insert(app.categories, {
					organizationId,
					name: 'Test income',
					kind: 'income',
					isSystem: false
				})
				.wait({ tier: 'global' })
			const businessExpense = await db
				.insert(app.categories, {
					organizationId: second.id,
					name: 'Business expenses',
					kind: 'expense',
					isSystem: false
				})
				.wait({ tier: 'global' })
			const rows = [
				{
					organizationId,
					accountId: checking.id,
					categoryId: expense.id,
					kind: 'expense',
					bookedOn: '2026-10-01',
					description: 'Older expense'
				},
				{
					organizationId,
					accountId: cash.id,
					categoryId: expense.id,
					kind: 'expense',
					bookedOn: '2026-10-12',
					description: 'Recent expense'
				},
				{
					organizationId,
					accountId: checking.id,
					categoryId: income.id,
					kind: 'income',
					bookedOn: '2026-10-05',
					description: 'Salary'
				},
				{
					organizationId: second.id,
					accountId: business.id,
					categoryId: businessExpense.id,
					kind: 'expense',
					bookedOn: '2026-10-13',
					description: 'Business expense'
				}
			] satisfies Pick<
				import('../../src/lib/schema.js').TransactionRow,
				'organizationId' | 'accountId' | 'categoryId' | 'kind' | 'bookedOn' | 'description'
			>[]
			for (const row of rows)
				await db
					.insert(app.transactions, {
						...row,
						amountMinor: 1234,
						currency: 'USD',
						source: 'manual',
						...(row.kind === 'income' ? { paymentMethod: 'cash' } : {})
					})
					.wait({ tier: 'global' })
			return { secondWorkspaceId: second.id, accountId: checking.id, categoryId: expense.id }
		}, firstWorkspaceId)
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
		await page.evaluate(
			async ({ organizationId, accountId, categoryId }) => {
				const { app, db } = window.workspaceSettingsTest
				await db
					.insert(app.transactions, {
						organizationId,
						accountId,
						categoryId,
						kind: 'expense',
						bookedOn: '2026-10-13',
						description: 'Live expense',
						amountMinor: 100,
						currency: 'USD',
						source: 'manual'
					})
					.wait({ tier: 'global' })
			},
			{ organizationId: firstWorkspaceId, ...fixture }
		)
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
		const fixture = await page.evaluate(async (organizationId) => {
			const { app, db } = window.workspaceSettingsTest
			const account = await db
				.insert(app.accounts, {
					organizationId,
					name: 'Daily checking',
					kind: 'bank',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const tzs = await db
				.insert(app.accounts, {
					organizationId,
					name: 'TZS account',
					kind: 'bank',
					currency: 'TZS'
				})
				.wait({ tier: 'global' })
			const category = await db
				.insert(app.categories, {
					organizationId,
					name: 'Daily category',
					kind: 'expense',
					isSystem: false
				})
				.wait({ tier: 'global' })
			const tag = await db
				.insert(app.tags, {
					organizationId,
					name: 'Historical tag',
					kind: category.kind,
					categoryId: category.id
				})
				.wait({ tier: 'global' })
			const first = await db
				.insert(app.transactions, {
					organizationId,
					accountId: account.id,
					categoryId: category.id,
					kind: 'expense',
					amountMinor: 1000,
					currency: 'USD',
					bookedOn: '2026-03-10',
					description: 'First daily entry',
					source: 'manual'
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.transactionTags, { organizationId, transactionId: first.id, tagId: tag.id })
				.wait({ tier: 'global' })
			await db
				.insert(app.transactions, {
					organizationId,
					accountId: account.id,
					categoryId: category.id,
					kind: 'expense',
					amountMinor: 250,
					currency: 'USD',
					bookedOn: '2026-03-10',
					source: 'manual'
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.transactions, {
					organizationId,
					accountId: tzs.id,
					categoryId: category.id,
					kind: 'expense',
					amountMinor: 300,
					currency: 'TZS',
					bookedOn: '2026-03-10',
					description: 'TZS daily entry',
					source: 'manual'
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.transactions, {
					organizationId,
					accountId: account.id,
					categoryId: category.id,
					kind: 'expense',
					amountMinor: 50,
					currency: 'USD',
					bookedOn: '2026-03-09',
					description: 'Previous day',
					source: 'manual'
				})
				.wait({ tier: 'global' })
			await db.update(app.tags, tag.id, { archivedAt: new Date() }).wait({ tier: 'global' })
			await db
				.update(app.categories, category.id, { archivedAt: new Date() })
				.wait({ tier: 'global' })
			return { accountId: account.id, categoryId: category.id, tagId: tag.id }
		}, organizationId)
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
		await page.evaluate(async (fixture) => {
			const { app, db } = window.workspaceSettingsTest
			await db
				.update(app.accounts, fixture.accountId, {
					name: 'Renamed daily account',
					archivedAt: new Date()
				})
				.wait({ tier: 'global' })
			// System categories are protected; this is an ordinary category already archived.
			await db
				.update(app.categories, fixture.categoryId, { name: 'Renamed daily category' })
				.wait({ tier: 'global' })
			await db
				.update(app.tags, fixture.tagId, { name: 'Renamed historical tag' })
				.wait({ tier: 'global' })
		}, fixture)
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
