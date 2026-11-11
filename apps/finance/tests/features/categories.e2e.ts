import { expect } from '@playwright/test'
import { test, start, installWorkspaceSettingsTest } from '../helpers/workspace.js'
import {
	navigateSidebar,
	openCreationModal,
	closeCreationModal,
	creationDialog,
	selectWorkspace
} from '../helpers/ui.js'

test(
	'category page creates both kinds, validates names, resets drafts, and persists after reload',
	{ tag: ['@categories', '@workflow-completion'] },
	async ({ page }) => {
		await start(page)
		const navigation = page.getByRole('navigation')
		const categoryWorkspaceId = await page
			.getByLabel('Current Workspace', { exact: true })
			.inputValue()
		await navigation.getByRole('link', { name: 'Categories', exact: true }).click()
		await expect(page).toHaveURL(`/settings/categories?workspace=${categoryWorkspaceId}`)
		const main = page.getByRole('main')
		const modal = await openCreationModal(page, 'Add Category')
		const name = modal.getByLabel('Category name', { exact: true })
		const kind = modal.getByLabel('Transaction type', { exact: true })
		const add = modal.getByRole('button', { name: 'Add Category', exact: true })
		await name.fill('   ')
		await add.click()
		await expect(modal.getByRole('alert').locator('p')).toHaveText([
			'Enter Category name',
			'Select an option for Transaction type'
		])
		await name.fill('  Travel  ')
		await add.click()
		await expect(modal.getByRole('status')).toHaveText('Category Travel saved.')
		await closeCreationModal(page)
		await expect(main.getByRole('row', { name: /Travel Expenses/ })).toBeVisible()
		await openCreationModal(page, 'Add Category')
		await name.fill('  Bonus  ')
		await kind.selectOption('income')
		await add.click()
		await expect(modal.getByRole('status')).toHaveText('Category Bonus saved.')
		await closeCreationModal(page)
		await expect(main.getByRole('row', { name: /Bonus Income/ })).toBeVisible()
		await openCreationModal(page, 'Add Category')
		await name.fill('Unsaved category')
		const secondId = await page.evaluate(async () => {
			const { app, db, userId } = window.workspaceSettingsTest
			const org = await db
				.insert(app.organizations, {
					name: 'Category second workspace',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: userId
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.organizationMembers, {
					organizationId: org.id,
					userId,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
			return org.id
		})
		const selector = page.getByLabel('Current Workspace', { exact: true })
		const firstId = await selector.inputValue()
		await expect(selector.locator(`option[value="${secondId}"]`)).toHaveCount(1)
		await selectWorkspace(selector, secondId)
		await openCreationModal(page, 'Add Category')
		await expect(name).toHaveValue('')
		await expect(main.getByRole('row', { name: /Travel Expenses/ })).toHaveCount(0)
		await expect(main.getByText('No Categories yet.')).toBeVisible()
		await name.fill('Second workspace category')
		await add.click()
		await expect(modal.getByRole('status')).toHaveText('Category Second workspace category saved.')
		await selectWorkspace(selector, firstId)
		await expect(main.getByRole('row', { name: /Travel Expenses/ })).toBeVisible()
		await expect(main.getByRole('row', { name: /Second workspace category/ })).toHaveCount(0)
		await page.reload()
		await expect(main.getByRole('row', { name: /Travel Expenses/ })).toBeVisible()
		await expect(main.getByRole('row', { name: /Bonus Income/ })).toBeVisible()
	}
)

test(
	'category page counts connections, archives offline, protects system categories, and retains history',
	{ tag: ['@categories', '@workflow-completion'] },
	async ({ page, context }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const fixture = await page.evaluate(async (organizationId) => {
			const { app, db } = window.workspaceSettingsTest
			const category = await db
				.insert(app.categories, {
					organizationId,
					name: 'Counted category',
					kind: 'expense',
					isSystem: false
				})
				.wait({ tier: 'global' })
			const account = await db
				.insert(app.accounts, {
					organizationId,
					name: 'Count account',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const transaction = await db
				.insert(app.transactions, {
					organizationId,
					accountId: account.id,
					categoryId: category.id,
					kind: 'expense',
					amountMinor: 100,
					currency: 'USD',
					bookedOn: '2026-10-13',
					description: 'Category retained history',
					source: 'manual'
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.tags, {
					organizationId,
					name: 'Active connected tag',
					kind: category.kind,
					categoryId: category.id
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.tags, {
					organizationId,
					name: 'Archived connected tag',
					kind: category.kind,
					categoryId: category.id,
					archivedAt: new Date()
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.tags, { organizationId, name: 'Unconnected tag', kind: 'expense' })
				.wait({ tier: 'global' })
			const system = await db.one(
				app.categories.where({ organizationId, isSystem: true, kind: 'expense' })
			)
			if (!system) throw new Error('Missing system category')
			return { categoryId: category.id, transactionId: transaction.id, systemId: system.id }
		}, organizationId)
		await navigateSidebar(page, 'Categories')
		const main = page.getByRole('main')
		const row = main
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: 'Counted category', exact: true }) })
		await expect(row.getByRole('cell').nth(1)).toHaveText('1')
		await expect(row.getByRole('cell').nth(2)).toHaveText('2')
		await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).uncheck()
		await expect(row.getByRole('cell').nth(1)).toHaveText('1')
		const systemRows = main
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: 'Uncategorized', exact: true }) })
		await expect(systemRows).toHaveCount(2)
		await expect(systemRows.getByRole('button')).toHaveCount(0)
		const systemOutcome = await page.evaluate(async (id) => {
			const { app, db } = window.workspaceSettingsTest
			try {
				await db.update(app.categories, id, { archivedAt: new Date() }).wait({ tier: 'global' })
				return 'accepted'
			} catch (error) {
				return error instanceof Error ? error.message : 'unknown-error'
			}
		}, fixture.systemId)
		expect(systemOutcome).toMatch(/AuthorizationDenied|permission_denied/)
		await context.setOffline(true)
		try {
			await row.getByRole('button', { name: 'Archive Counted category', exact: true }).click()
			await expect(
				main.getByRole('status').filter({ hasText: 'Category Counted category archived.' })
			).toHaveText('Category Counted category archived.')
			await expect(row).toHaveCount(0)
		} finally {
			await context.setOffline(false)
		}
		await expect
			.poll(() =>
				page.evaluate(async ({ categoryId, transactionId }) => {
					const { app, db } = window.workspaceSettingsTest
					const category = await db.one(app.categories.where({ id: categoryId }), {
						tier: 'remote'
					})
					const transaction = await db.one(app.transactions.where({ id: transactionId }), {
						tier: 'remote'
					})
					const tags = await db.all(app.tags.where({ categoryId }), { tier: 'remote' })
					return {
						archived: Boolean(category?.archivedAt),
						retained: transaction?.categoryId === categoryId,
						tags: tags.length
					}
				}, fixture)
			)
			.toEqual({ archived: true, retained: true, tags: 2 })
		await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).check()
		await navigateSidebar(page, 'Expenses')
		await expect(main.getByText('Category retained history', { exact: true })).toBeVisible()
		await page.getByRole('link', { name: 'Add Expenses', exact: true }).click()
		await expect(
			main.getByLabel('Category', { exact: true }).locator(`option[value="${fixture.categoryId}"]`)
		).toHaveCount(0)
	}
)

for (const role of ['admin', 'member', 'viewer']) {
	test(
		`category page permissions: ${role}`,
		{ tag: ['@categories', '@workflow-completion', '@permissions'] },
		async ({ page, browser }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
			try {
				const subject = await otherContext.newPage()
				await start(subject)
				const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
				const categoryId = await page.evaluate(
					async ({ organizationId, subjectId, role }) => {
						const { app, db } = window.workspaceSettingsTest
						if (role !== 'admin' && role !== 'member' && role !== 'viewer')
							throw new Error('Invalid role')
						await db
							.insert(app.organizationMembers, {
								organizationId,
								userId: subjectId,
								role,
								accountAccessMode: 'all'
							})
							.wait({ tier: 'global' })
						return (
							await db
								.insert(app.categories, {
									organizationId,
									name: 'Permission category',
									kind: 'expense',
									isSystem: false
								})
								.wait({ tier: 'global' })
						).id
					},
					{ organizationId, subjectId, role }
				)
				await subject.reload()
				await installWorkspaceSettingsTest(subject)
				const selector = subject.getByLabel('Current Workspace', { exact: true })
				await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
				await selectWorkspace(selector, organizationId)
				await navigateSidebar(subject, 'Categories')
				const main = subject.getByRole('main')
				const row = main.getByRole('row').filter({
					has: subject.getByRole('rowheader', { name: 'Permission category', exact: true })
				})
				await expect(row).toBeVisible()
				const add = main.getByRole('button', { name: 'Add Category', exact: true }).first()
				if (role === 'viewer') {
					await expect(add).toBeEnabled()
					await add.click()
					const blocked = creationDialog(subject, 'Add Category')
					await expect(blocked.getByLabel('Category name', { exact: true })).toBeDisabled()
					await expect(
						blocked.getByRole('button', { name: 'Add Category', exact: true })
					).toBeDisabled()
					await blocked.getByRole('button', { name: 'Cancel', exact: true }).click()
					await expect(row.getByRole('button')).toHaveCount(0)
					const outcomes = await subject.evaluate(
						async ({ organizationId, categoryId }) => {
							const { app, db } = window.workspaceSettingsTest
							const results: string[] = []
							try {
								await db
									.insert(app.categories, {
										organizationId,
										name: 'Forbidden category',
										kind: 'expense',
										isSystem: false
									})
									.wait({ tier: 'global' })
								results.push('accepted')
							} catch (error) {
								results.push(error instanceof Error ? error.message : 'unknown-error')
							}
							try {
								await db
									.update(app.categories, categoryId, { archivedAt: new Date() })
									.wait({ tier: 'global' })
								results.push('accepted')
							} catch (error) {
								results.push(error instanceof Error ? error.message : 'unknown-error')
							}
							return results
						},
						{ organizationId, categoryId }
					)
					for (const outcome of outcomes)
						expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
				} else {
					const modal = await openCreationModal(subject, 'Add Category')
					await modal.getByLabel('Category name', { exact: true }).fill(`${role} category`)
					await modal.getByRole('button', { name: 'Add Category', exact: true }).click()
					await expect(modal.getByRole('status')).toHaveText(`Category ${role} category saved.`)
					await closeCreationModal(subject)
					await row
						.getByRole('button', { name: 'Archive Permission category', exact: true })
						.click()
					await expect(
						main.getByRole('status').filter({ hasText: 'Permission category archived.' })
					).toBeVisible()
					await expect(row).toHaveCount(0)
				}
				await expect
					.poll(() =>
						page.evaluate(async (id) => {
							const { app, db } = window.workspaceSettingsTest
							return Boolean(
								(await db.one(app.categories.where({ id }), { tier: 'remote' }))?.archivedAt
							)
						}, categoryId)
					)
					.toBe(role !== 'viewer')
			} finally {
				await otherContext.close()
			}
		}
	)
}

test(
	'category page counts only readable transactions for selected account access',
	{ tag: ['@categories', '@workflow-completion', '@permissions'] },
	async ({ page, browser }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
		try {
			const subject = await otherContext.newPage()
			await start(subject)
			const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
			await page.evaluate(
				async ({ organizationId, subjectId }) => {
					const { app, db } = window.workspaceSettingsTest
					await db
						.insert(app.organizationMembers, {
							organizationId,
							userId: subjectId,
							role: 'viewer',
							accountAccessMode: 'selected'
						})
						.wait({ tier: 'global' })
					const category = await db
						.insert(app.categories, {
							organizationId,
							name: 'Scoped count',
							kind: 'expense',
							isSystem: false
						})
						.wait({ tier: 'global' })
					for (const name of ['Readable count account', 'Private count account']) {
						const account = await db
							.insert(app.accounts, { organizationId, name, kind: 'cash', currency: 'USD' })
							.wait({ tier: 'global' })
						await db
							.insert(app.transactions, {
								organizationId,
								accountId: account.id,
								categoryId: category.id,
								kind: 'expense',
								amountMinor: 100,
								currency: 'USD',
								bookedOn: '2026-10-13',
								source: 'manual'
							})
							.wait({ tier: 'global' })
						if (name === 'Readable count account') {
							await db
								.insert(app.accountMemberships, {
									organizationId,
									userId: subjectId,
									accountId: account.id,
									access: 'read',
									canDelete: false
								})
								.wait({ tier: 'global' })
						}
					}
				},
				{ organizationId, subjectId }
			)
			await subject.reload()
			await installWorkspaceSettingsTest(subject)
			const selector = subject.getByLabel('Current Workspace', { exact: true })
			await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
			await selectWorkspace(selector, organizationId)
			await navigateSidebar(subject, 'Categories')
			await navigateSidebar(page, 'Categories')
			const ownerRow = page
				.getByRole('row')
				.filter({ has: page.getByRole('rowheader', { name: 'Scoped count', exact: true }) })
			const subjectRow = subject
				.getByRole('row')
				.filter({ has: subject.getByRole('rowheader', { name: 'Scoped count', exact: true }) })
			await expect(ownerRow.getByRole('cell').nth(1)).toHaveText('2')
			await expect(subjectRow.getByRole('cell').nth(1)).toHaveText('1')
		} finally {
			await otherContext.close()
		}
	}
)
