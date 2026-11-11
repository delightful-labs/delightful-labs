import { expect } from '@playwright/test'
import { test, start, installWorkspaceSettingsTest } from '../helpers/workspace.js'
import {
	navigateSidebar,
	openCreationModal,
	openAccountActions,
	selectWorkspace
} from '../helpers/ui.js'
import type { OrganizationMember } from '../../src/lib/schema.js'

test(
	'account list shows an empty result and newly created accounts',
	{ tag: ['@workflow-completion', '@accounts'] },
	async ({ page }) => {
		await page.goto('/accounts')
		const main = page.getByRole('main')
		await expect(main.getByText('Start with one place you keep money.')).toBeVisible()
		await expect(main.getByRole('table')).toHaveCount(0)
		const modal = await openCreationModal(page, 'Add Account')
		await modal.getByLabel('Account name').fill('Everyday checking')
		await modal.getByLabel('Account type').selectOption('bank')
		await modal.getByRole('button', { name: 'Add Account' }).click()
		await expect(modal.getByRole('status')).toContainText('Everyday checking')
		await navigateSidebar(page, 'Accounts')
		await expect(main.getByRole('cell', { name: 'Everyday checking', exact: true })).toBeVisible()
		await expect(main.getByRole('cell', { name: 'Bank', exact: true })).toBeVisible()
		await expect(main.getByRole('cell', { name: 'USD', exact: true })).toBeVisible()
		await expect(main.getByText('Start with one place you keep money.')).toHaveCount(0)
		await page.reload()
		await expect(main.getByRole('cell', { name: 'Everyday checking', exact: true })).toBeVisible()
	}
)

test(
	'account form rejects whitespace and allows corrected cash, bank, and card submissions',
	{ tag: ['@workflow-completion', '@accounts'] },
	async ({ page }) => {
		for (const kind of ['cash', 'bank', 'card']) {
			await page.goto('/accounts')
			const modal = await openCreationModal(page, 'Add Account')
			await modal.getByLabel('Account name').fill('   ')
			await modal.getByLabel('Account type').selectOption(kind)
			await modal.getByRole('button', { name: 'Add Account' }).click()
			await expect(modal.getByRole('alert').locator('p')).toHaveText([
				'Enter Account name',
				'Select an option for Account type'
			])
			await expect(modal.getByLabel('Account type')).toHaveValue(kind)
			await modal.getByLabel('Account name').fill(`  Test ${kind}  `)
			await modal.getByRole('button', { name: 'Add Account' }).click()
			await expect(modal.getByRole('status')).toHaveText(`Account Test ${kind} saved.`)
			await navigateSidebar(page, 'Accounts')
			await expect(
				page.getByRole('main').getByRole('cell', { name: `Test ${kind}`, exact: true })
			).toHaveCount(1)
		}
	}
)

test(
	'account form resets its draft and saves to the selected workspace',
	{ tag: ['@workflow-completion', '@workspaces', '@accounts'] },
	async ({ page }) => {
		await start(page)
		const firstWorkspaceId = await page
			.getByLabel('Current Workspace', { exact: true })
			.inputValue()
		const secondWorkspaceId = await page.evaluate(async () => {
			const { app, db, userId } = window.workspaceSettingsTest
			const workspace = await db
				.insert(app.organizations, {
					name: 'Account form workspace',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: userId
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.organizationMembers, {
					organizationId: workspace.id,
					userId,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
			return workspace.id
		})
		await navigateSidebar(page, 'Accounts')
		const modal = await openCreationModal(page, 'Add Account')
		await modal.getByLabel('Account name').fill('Previous workspace draft')
		await modal.getByLabel('Account type').selectOption('cash')
		const selector = page.getByLabel('Current Workspace', { exact: true })
		await selectWorkspace(selector, secondWorkspaceId)
		await openCreationModal(page, 'Add Account')
		await expect(modal.getByLabel('Account name')).toHaveValue('')
		await expect(modal.getByLabel('Account type')).toHaveValue('')
		await modal.getByLabel('Account name').fill('Business checking')
		await modal.getByLabel('Account type').selectOption('bank')
		await modal.getByRole('button', { name: 'Add Account' }).click()
		await expect(modal.getByRole('status')).toHaveText('Account Business checking saved.')
		await selectWorkspace(selector, firstWorkspaceId)
		await openCreationModal(page, 'Add Account')
		await expect(modal.getByLabel('Account name')).toHaveValue('')
		await expect(modal.getByRole('status')).toHaveCount(0)
		await navigateSidebar(page, 'Accounts')
		await expect(
			page.getByRole('main').getByText('Start with one place you keep money.')
		).toBeVisible()
		await selectWorkspace(selector, secondWorkspaceId)
		await expect(
			page.getByRole('main').getByRole('cell', { name: 'Business checking', exact: true })
		).toBeVisible()
	}
)

test(
	'account list sorts active accounts, updates live, and follows workspace selection',
	{ tag: ['@workspaces', '@accounts'] },
	async ({ page }) => {
		await start(page)
		const firstWorkspaceId = await page
			.getByLabel('Current Workspace', { exact: true })
			.inputValue()
		const fixture = await page.evaluate(async (organizationId) => {
			const { app, db, userId } = window.workspaceSettingsTest
			const second = await db
				.insert(app.organizations, {
					name: 'Other ledger',
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
			const accounts = [
				{ organizationId, name: 'Zebra checking', kind: 'bank', archivedAt: null },
				{ organizationId, name: 'Alpha cash', kind: 'cash', archivedAt: null },
				{ organizationId, name: 'Archived card', kind: 'card', archivedAt: new Date() },
				{ organizationId: second.id, name: 'Business card', kind: 'card', archivedAt: null }
			] satisfies Pick<
				import('../../src/lib/schema.js').Account,
				'organizationId' | 'name' | 'kind' | 'archivedAt'
			>[]
			const ids: string[] = []
			for (const account of accounts) {
				const row = await db
					.insert(app.accounts, { ...account, archivedAt: null, currency: 'USD' })
					.wait({ tier: 'global' })
				if (account.archivedAt)
					await db
						.update(app.accounts, row.id, { archivedAt: account.archivedAt })
						.wait({ tier: 'global' })
				ids.push(row.id)
			}
			return { secondWorkspaceId: second.id, firstAccountId: ids[0] }
		}, firstWorkspaceId)
		await navigateSidebar(page, 'Accounts')
		const main = page.getByRole('main')
		const names = main.getByRole('table').locator('tbody tr td:first-child')
		await expect(names).toHaveText(['Alpha cash', 'Zebra checking'])
		await expect(main.getByRole('cell', { name: 'Archived card', exact: true })).toHaveCount(0)
		const selector = page.getByLabel('Current Workspace', { exact: true })
		await selectWorkspace(selector, fixture.secondWorkspaceId)
		await expect(names).toHaveText(['Business card'])
		await selectWorkspace(selector, firstWorkspaceId)
		await expect(names).toHaveText(['Alpha cash', 'Zebra checking'])
		await page.evaluate(async (id) => {
			if (!id) throw new Error('Test account is missing.')
			const { app, db } = window.workspaceSettingsTest
			await db.update(app.accounts, id, { archivedAt: new Date() }).wait({ tier: 'global' })
		}, fixture.firstAccountId)
		await expect(names).toHaveText(['Alpha cash'])
	}
)

test(
	'account archive works offline, retains history, and excludes new-entry options',
	{ tag: ['@account-archive', '@accounts'] },
	async ({ page, context }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const fixture = await page.evaluate(async (organizationId) => {
			const { app, db } = window.workspaceSettingsTest
			const account = await db
				.insert(app.accounts, {
					organizationId,
					name: 'Archive checking',
					kind: 'bank',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const category = await db.one(
				app.categories.where({ organizationId, kind: 'expense', isSystem: true }),
				{ tier: 'remote' }
			)
			if (!category) throw new Error('Expense category is missing.')
			const transaction = await db
				.insert(app.transactions, {
					organizationId,
					accountId: account.id,
					categoryId: category.id,
					kind: 'expense',
					amountMinor: 1200,
					currency: 'USD',
					bookedOn: '2026-10-13',
					source: 'manual',
					description: 'Retained archived history'
				})
				.wait({ tier: 'global' })
			return { accountId: account.id, transactionId: transaction.id }
		}, organizationId)
		await navigateSidebar(page, 'Accounts')
		const main = page.getByRole('main')
		const accountActions = await openAccountActions(page, 'Archive checking')
		await expect(accountActions.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled()
		await context.setOffline(true)
		try {
			await accountActions.getByRole('button', { name: 'Archive', exact: true }).click()
			await expect(
				main.getByRole('status').filter({ hasText: 'Account Archive checking archived.' })
			).toHaveText('Account Archive checking archived.')
			await expect(main.getByRole('cell', { name: 'Archive checking', exact: true })).toHaveCount(0)
			await expect(
				page.getByRole('checkbox', { name: 'Show Archive checking', exact: true })
			).toHaveCount(0)
		} finally {
			await context.setOffline(false)
		}
		await expect
			.poll(() =>
				page.evaluate(async (fixture) => {
					const { app, db } = window.workspaceSettingsTest
					const account = await db.one(app.accounts.where({ id: fixture.accountId }), {
						tier: 'remote'
					})
					const transaction = await db.one(app.transactions.where({ id: fixture.transactionId }), {
						tier: 'remote'
					})
					return {
						archived: Boolean(account?.archivedAt),
						retained: transaction?.id === fixture.transactionId
					}
				}, fixture)
			)
			.toEqual({ archived: true, retained: true })
		await navigateSidebar(page, 'Expenses')
		await expect(main.getByText('Retained archived history', { exact: true })).toBeVisible()
		await main.getByRole('link', { name: 'Add Expenses', exact: true }).click()
		await expect(main.getByText('Add an account before recording a transaction.')).toBeVisible()
		await page.goto('/accounts')
		await expect(main.getByText('Start with one place you keep money.')).toBeVisible()
	}
)

const archiveScenarios: {
	name: string
	role: NonNullable<OrganizationMember['role']>
	mode: OrganizationMember['accountAccessMode']
	grant?: 'read' | 'write'
	write: boolean
}[] = [
	{ name: 'admin', role: 'admin', mode: 'selected', write: true },
	{ name: 'member with all access', role: 'member', mode: 'all', write: true },
	{
		name: 'member with a write grant',
		role: 'member',
		mode: 'selected',
		grant: 'write',
		write: true
	},
	{
		name: 'member with a read grant',
		role: 'member',
		mode: 'selected',
		grant: 'read',
		write: false
	},
	{ name: 'viewer with a write grant', role: 'viewer', mode: 'all', grant: 'write', write: false }
]

for (const scenario of archiveScenarios) {
	test(
		`account archive permissions: ${scenario.name}`,
		{ tag: ['@account-archive', '@permissions', '@accounts'] },
		async ({ page, browser, baseURL }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const subjectContext = await browser.newContext({
				baseURL: baseURL ?? 'http://127.0.0.1:5173'
			})
			try {
				const subject = await subjectContext.newPage()
				await start(subject)
				const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
				const accountId = await page.evaluate(
					async ({ organizationId, subjectId, scenario }) => {
						const { app, db } = window.workspaceSettingsTest
						const account = await db
							.insert(app.accounts, {
								organizationId,
								name: 'Permission checking',
								kind: 'bank',
								currency: 'USD'
							})
							.wait({ tier: 'global' })
						await db
							.insert(app.organizationMembers, {
								organizationId,
								userId: subjectId,
								role: scenario.role,
								accountAccessMode: scenario.mode
							})
							.wait({ tier: 'global' })
						if (scenario.grant)
							await db
								.insert(app.accountMemberships, {
									organizationId,
									accountId: account.id,
									userId: subjectId,
									access: scenario.grant,
									canDelete: false
								})
								.wait({ tier: 'global' })
						return account.id
					},
					{ organizationId, subjectId, scenario }
				)
				await subject.reload()
				await installWorkspaceSettingsTest(subject)
				await subject.goto(`/accounts?workspace=${organizationId}`)
				await installWorkspaceSettingsTest(subject)
				const selector = subject.getByLabel('Current Workspace', { exact: true })
				await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
				await selectWorkspace(selector, organizationId)
				const row = subject
					.getByRole('main')
					.getByRole('row')
					.filter({ has: subject.getByRole('cell', { name: 'Permission checking', exact: true }) })
				await expect(row).toBeVisible()
				const accountActions = await openAccountActions(subject, 'Permission checking')
				const archive = accountActions.getByRole('button', { name: 'Archive', exact: true })
				if (scenario.write) {
					await expect(archive).toBeEnabled()
					await archive.click()
					await expect(
						subject
							.getByRole('main')
							.getByRole('status')
							.filter({ hasText: 'Account Permission checking archived.' })
					).toHaveText('Account Permission checking archived.')
					await expect(row).toHaveCount(0)
				} else {
					await expect(archive).toHaveCount(0)
					const outcome = await subject.evaluate(async (accountId) => {
						const { app, db } = window.workspaceSettingsTest
						try {
							await db
								.update(app.accounts, accountId, { archivedAt: new Date() })
								.wait({ tier: 'global' })
							return 'accepted'
						} catch (error) {
							return error instanceof Error ? error.message : 'unknown-error'
						}
					}, accountId)
					expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
				}
				await expect
					.poll(() =>
						page.evaluate(async (id) => {
							const { app, db } = window.workspaceSettingsTest
							const account = await db.one(app.accounts.where({ id }), { tier: 'remote' })
							return { exists: Boolean(account), archived: Boolean(account?.archivedAt) }
						}, accountId)
					)
					.toEqual({ exists: true, archived: scenario.write })
			} finally {
				await subjectContext.close()
			}
		}
	)
}
