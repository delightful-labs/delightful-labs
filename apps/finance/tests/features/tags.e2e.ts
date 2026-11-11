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
	'tag page creates optional categories, rejects blank names, filters archived categories, and persists',
	{ tag: ['@tags', '@workflow-completion'] },
	async ({ page }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const categoryId = await page.evaluate(async (organizationId) => {
			const { app, db } = window.workspaceSettingsTest
			await db
				.insert(app.categories, {
					organizationId,
					name: 'Archived choice',
					kind: 'expense',
					isSystem: false,
					archivedAt: new Date()
				})
				.wait({ tier: 'global' })
			return (
				await db
					.insert(app.categories, {
						organizationId,
						name: 'Tag category',
						kind: 'expense',
						isSystem: false
					})
					.wait({ tier: 'global' })
			).id
		}, organizationId)
		await navigateSidebar(page, 'Tags')
		await expect(page).toHaveURL(`/settings/tags?workspace=${organizationId}`)
		const main = page.getByRole('main')
		const modal = await openCreationModal(page, 'Add Tag')
		const name = modal.getByLabel('Tag name', { exact: true })
		const category = modal.getByLabel('Category', { exact: true })
		const add = modal.getByRole('button', { name: 'Add Tag', exact: true })
		await expect(
			category.getByRole('option', { name: 'Archived choice (Expenses)', exact: true })
		).toHaveCount(0)
		await expect(category).toHaveValue('')
		await name.fill('   ')
		await add.click()
		await expect(modal.getByRole('alert').locator('p')).toHaveText(['Enter Tag name'])
		await name.fill('  Unassigned tag  ')
		await add.click()
		await expect(modal.getByRole('status')).toHaveText('Tag Unassigned tag saved.')
		await closeCreationModal(page)
		await expect(
			main
				.getByRole('row')
				.filter({ has: page.getByRole('rowheader', { name: 'Unassigned tag', exact: true }) })
				.getByRole('cell', { name: 'No Category', exact: true })
		).toBeVisible()
		await openCreationModal(page, 'Add Tag')
		await name.fill('  Categorized tag  ')
		await category.selectOption(categoryId)
		await add.click()
		await expect(modal.getByRole('status')).toHaveText('Tag Categorized tag saved.')
		await closeCreationModal(page)
		await expect(
			main
				.getByRole('row')
				.filter({ has: page.getByRole('rowheader', { name: 'Categorized tag', exact: true }) })
				.getByRole('cell', { name: 'Tag category', exact: true })
		).toBeVisible()
		await page.evaluate(async (id) => {
			const { app, db } = window.workspaceSettingsTest
			await db.update(app.categories, id, { archivedAt: new Date() }).wait({ tier: 'global' })
		}, categoryId)
		await expect(
			main
				.getByRole('row')
				.filter({ has: page.getByRole('rowheader', { name: 'Categorized tag', exact: true }) })
				.getByRole('cell', { name: 'Tag category', exact: true })
		).toBeVisible()
		await openCreationModal(page, 'Add Tag')
		await expect(category.locator(`option[value="${categoryId}"]`)).toHaveCount(0)
		await expect(category).toHaveValue('')
		await page.reload()
		await expect(
			main
				.getByRole('row')
				.filter({ has: page.getByRole('rowheader', { name: 'Unassigned tag', exact: true }) })
				.getByRole('cell', { name: 'No Category', exact: true })
		).toBeVisible()
		await expect(
			main
				.getByRole('row')
				.filter({ has: page.getByRole('rowheader', { name: 'Categorized tag', exact: true }) })
				.getByRole('cell', { name: 'Tag category', exact: true })
		).toBeVisible()
	}
)

test(
	'tag page switches workspace drafts and archives offline without removing category connections',
	{ tag: ['@tags', '@workflow-completion', '@workspaces'] },
	async ({ page, context }) => {
		await start(page)
		const firstId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const fixture = await page.evaluate(async (organizationId) => {
			const { app, db, userId } = window.workspaceSettingsTest
			const category = await db
				.insert(app.categories, {
					organizationId,
					name: 'Retained tag category',
					kind: 'expense',
					isSystem: false
				})
				.wait({ tier: 'global' })
			const tag = await db
				.insert(app.tags, {
					organizationId,
					name: 'Archive tag',
					kind: category.kind,
					categoryId: category.id
				})
				.wait({ tier: 'global' })
			const org = await db
				.insert(app.organizations, {
					name: 'Second tag workspace',
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
			await db
				.insert(app.categories, {
					organizationId: org.id,
					name: 'Second category',
					kind: 'income',
					isSystem: false
				})
				.wait({ tier: 'global' })
			return { secondId: org.id, tagId: tag.id, categoryId: category.id }
		}, firstId)
		await navigateSidebar(page, 'Tags')
		const main = page.getByRole('main')
		const modal = await openCreationModal(page, 'Add Tag')
		const name = modal.getByLabel('Tag name', { exact: true })
		const selector = page.getByLabel('Current Workspace', { exact: true })
		await name.fill('Unsaved draft')
		await selectWorkspace(selector, fixture.secondId)
		await openCreationModal(page, 'Add Tag')
		await expect(name).toHaveValue('')
		await expect(main.getByText('No Tags yet.', { exact: true })).toBeVisible()
		const category = modal.getByLabel('Category', { exact: true })
		await expect(
			category.getByRole('option', { name: 'Retained tag category (Expenses)', exact: true })
		).toHaveCount(0)
		await name.fill('Second tag')
		await modal.getByRole('button', { name: 'Add Tag', exact: true }).click()
		await expect(modal.getByRole('status')).toHaveText('Tag Second tag saved.')
		await selectWorkspace(selector, firstId)
		await expect(main.getByRole('row', { name: /Second tag/ })).toHaveCount(0)
		const row = main
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: 'Archive tag', exact: true }) })
		await expect(row).toBeVisible()
		await context.setOffline(true)
		try {
			await row.getByRole('button', { name: 'Archive Archive tag', exact: true }).click()
			await expect(
				main.getByRole('status').filter({ hasText: 'Tag Archive tag archived.' })
			).toHaveText('Tag Archive tag archived.')
			await expect(row).toHaveCount(0)
		} finally {
			await context.setOffline(false)
		}
		await expect
			.poll(() =>
				page.evaluate(async ({ tagId, categoryId }) => {
					const { app, db } = window.workspaceSettingsTest
					const tag = await db.one(app.tags.where({ id: tagId }), { tier: 'remote' })
					return {
						archived: Boolean(tag?.archivedAt),
						categoryRetained: tag?.categoryId === categoryId
					}
				}, fixture)
			)
			.toEqual({ archived: true, categoryRetained: true })
		await navigateSidebar(page, 'Categories')
		const categoryRow = main
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: 'Retained tag category', exact: true }) })
		await expect(categoryRow.getByRole('cell').nth(2)).toHaveText('1')
	}
)

for (const role of ['admin', 'member', 'viewer']) {
	test(
		`tag page permissions: ${role}`,
		{ tag: ['@tags', '@workflow-completion', '@permissions'] },
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
				const tagId = await page.evaluate(
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
								.insert(app.tags, {
									organizationId,
									name: 'Permission tag',
									kind: 'expense'
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
				await navigateSidebar(subject, 'Tags')
				const main = subject.getByRole('main')
				const row = main.getByRole('row').filter({
					has: subject.getByRole('rowheader', { name: 'Permission tag', exact: true })
				})
				await expect(row).toBeVisible()
				const add = main.getByRole('button', { name: 'Add Tag', exact: true }).first()
				if (role === 'viewer') {
					await expect(add).toBeEnabled()
					await add.click()
					const blocked = creationDialog(subject, 'Add Tag')
					await expect(blocked.getByLabel('Tag name', { exact: true })).toBeDisabled()
					await expect(blocked.getByRole('button', { name: 'Add Tag', exact: true })).toBeDisabled()
					await blocked.getByRole('button', { name: 'Cancel', exact: true }).click()
					await expect(row.getByRole('button')).toHaveCount(0)
					const outcomes = await subject.evaluate(
						async ({ organizationId, tagId }) => {
							const { app, db } = window.workspaceSettingsTest
							const results: string[] = []
							try {
								await db
									.insert(app.tags, {
										organizationId,
										name: 'Forbidden tag',
										kind: 'expense'
									})
									.wait({ tier: 'global' })
								results.push('accepted')
							} catch (error) {
								results.push(error instanceof Error ? error.message : 'unknown-error')
							}
							try {
								await db
									.update(app.tags, tagId, { archivedAt: new Date() })
									.wait({ tier: 'global' })
								results.push('accepted')
							} catch (error) {
								results.push(error instanceof Error ? error.message : 'unknown-error')
							}
							return results
						},
						{ organizationId, tagId }
					)
					for (const outcome of outcomes)
						expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
				} else {
					const modal = await openCreationModal(subject, 'Add Tag')
					await modal.getByLabel('Tag name', { exact: true }).fill(`${role} tag`)
					await modal.getByRole('button', { name: 'Add Tag', exact: true }).click()
					await expect(modal.getByRole('status')).toHaveText(`Tag ${role} tag saved.`)
					await closeCreationModal(subject)
					await row.getByRole('button', { name: 'Archive Permission tag', exact: true }).click()
					await expect(
						main.getByRole('status').filter({ hasText: 'Permission tag archived.' })
					).toBeVisible()
					await expect(row).toHaveCount(0)
				}
				await expect
					.poll(() =>
						page.evaluate(async (id) => {
							const { app, db } = window.workspaceSettingsTest
							return Boolean((await db.one(app.tags.where({ id }), { tier: 'remote' }))?.archivedAt)
						}, tagId)
					)
					.toBe(role !== 'viewer')
			} finally {
				await otherContext.close()
			}
		}
	)
}

for (const kind of ['expense', 'income']) {
	test(
		`transaction tags ${kind} reuse existing tags, create categorized tags, remove selections, and reset`,
		{ tag: ['@transactions', '@tags', '@workflow-completion'] },
		async ({ page }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const fixture = await page.evaluate(
				async ({ organizationId, kind }) => {
					const { app, db } = window.workspaceSettingsTest
					if (kind !== 'expense' && kind !== 'income') throw new Error('Invalid kind')
					const account = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Tag entry account',
							kind: 'cash',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					const category = await db
						.insert(app.categories, {
							organizationId,
							name: 'Selected tag category',
							kind,
							isSystem: false
						})
						.wait({ tier: 'global' })
					const previous = await db
						.insert(app.categories, {
							organizationId,
							name: 'Existing tag category',
							kind,
							isSystem: false
						})
						.wait({ tier: 'global' })
					const tag = await db
						.insert(app.tags, {
							organizationId,
							name: 'Existing tag',
							kind,
							categoryId: previous.id
						})
						.wait({ tier: 'global' })
					await db
						.insert(app.tags, {
							organizationId,
							name: 'Archived entry tag',
							kind,
							archivedAt: new Date()
						})
						.wait({ tier: 'global' })
					return {
						accountId: account.id,
						categoryId: category.id,
						previousId: previous.id,
						tagId: tag.id
					}
				},
				{ organizationId, kind }
			)
			const navigation = page.getByRole('navigation')
			await navigation
				.getByRole('link', { name: kind === 'expense' ? 'Expenses' : 'Income', exact: true })
				.click()
			await page
				.getByRole('link', {
					name: kind === 'expense' ? 'Add Expenses' : 'Add Income',
					exact: true
				})
				.click()
			const main = page.getByRole('main')
			await main.getByLabel('Account', { exact: true }).selectOption(fixture.accountId)
			await main.getByLabel('Category', { exact: true }).selectOption(fixture.categoryId)
			await main.getByLabel('Amount', { exact: true }).fill('12.34')
			const tags = main
				.getByRole('combobox', { name: 'Tags', exact: true })
				.or(main.getByRole('textbox', { name: 'Tags', exact: true }))
			await tags.fill('Archived')
			await expect(
				page.getByRole('option', { name: 'Archived entry tag', exact: true })
			).toHaveCount(0)
			await tags.fill('Existing')
			await page.getByRole('option', { name: 'Existing tag', exact: true }).click()
			await tags.fill(' New tag ')
			await tags.press('Enter')
			await tags.fill('Removed tag')
			await tags.press('Enter')
			await main.getByRole('button', { name: 'Remove Removed tag', exact: true }).click()
			await tags.fill('existing tag')
			await tags.press('Enter')
			await expect(
				main.getByText('Tag existing tag is already selected.', { exact: true })
			).toBeVisible()
			await main.getByLabel('Memo (additional notes)', { exact: true }).fill('Tagged entry')
			await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await expect(page).toHaveURL(
				`${kind === 'income' ? '/income' : '/expenses'}?workspace=${organizationId}`
			)
			await expect
				.poll(() =>
					page.evaluate(
						async ({ organizationId, fixture }) => {
							const { app, db } = window.workspaceSettingsTest
							const transactions = await db.all(
								app.transactions.where({ organizationId, memo: 'Tagged entry' }),
								{ tier: 'remote' }
							)
							const transaction = transactions[0]
							if (!transaction) return null
							const links = await db.all(
								app.transactionTags.where({ transactionId: transaction.id }),
								{ tier: 'remote' }
							)
							const tags = await db.all(app.tags.where({ organizationId }), { tier: 'remote' })
							return {
								transactions: transactions.length,
								links: links.length,
								existingCategory: tags.find((tag) => tag.id === fixture.tagId)?.categoryId,
								newCategory: tags.find((tag) => tag.name === 'New tag')?.categoryId,
								removed: tags.some((tag) => tag.name === 'Removed tag'),
								linkedNames: links
									.map((link) => tags.find((tag) => tag.id === link.tagId)?.name)
									.sort()
							}
						},
						{ organizationId, fixture }
					)
				)
				.toEqual({
					transactions: 1,
					links: 2,
					existingCategory: fixture.previousId,
					newCategory: fixture.categoryId,
					removed: false,
					linkedNames: ['Existing tag', 'New tag']
				})
			await main
				.getByRole('link', {
					name: kind === 'expense' ? 'Add Expenses' : 'Add Income',
					exact: true
				})
				.click()
			await expect(main.getByRole('button', { name: /^Remove / })).toHaveCount(0)
			await expect(tags).toHaveValue('')
			await main.getByLabel('Account', { exact: true }).selectOption(fixture.accountId)
			await main.getByLabel('Amount', { exact: true }).fill('2')
			await main.getByLabel('Memo (additional notes)', { exact: true }).fill('No tags entry')
			await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await expect(page).toHaveURL(
				`${kind === 'income' ? '/income' : '/expenses'}?workspace=${organizationId}`
			)
			await expect
				.poll(() =>
					page.evaluate(async (organizationId) => {
						const { app, db } = window.workspaceSettingsTest
						const transaction = await db.one(
							app.transactions.where({ organizationId, memo: 'No tags entry' }),
							{ tier: 'remote' }
						)
						if (!transaction) return -1
						return (
							await db.all(app.transactionTags.where({ transactionId: transaction.id }), {
								tier: 'remote'
							})
						).length
					}, organizationId)
				)
				.toBe(0)
		}
	)
}

test(
	'transaction tags reject a tag archived after selection without saving partial data and allow retry',
	{ tag: ['@transactions', '@tags', '@workflow-completion'] },
	async ({ page }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const tagId = await page.evaluate(async (organizationId) => {
			const { app, db } = window.workspaceSettingsTest
			await db
				.insert(app.accounts, {
					organizationId,
					name: 'Retry tag account',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			return (
				await db
					.insert(app.tags, {
						organizationId,
						name: 'Archive while selected',
						kind: 'expense'
					})
					.wait({ tier: 'global' })
			).id
		}, organizationId)
		await navigateSidebar(page, 'Expenses')
		await page.getByRole('link', { name: 'Add Expenses', exact: true }).click()
		const main = page.getByRole('main')
		await main
			.getByLabel('Account', { exact: true })
			.selectOption({ label: 'Retry tag account · USD' })
		await main.getByLabel('Amount', { exact: true }).fill('5')
		await main.getByLabel('Memo (additional notes)', { exact: true }).fill('Retry tagged entry')
		const tags = main
			.getByRole('combobox', { name: 'Tags', exact: true })
			.or(main.getByRole('textbox', { name: 'Tags', exact: true }))
		await tags.fill('Archive while')
		await page.getByRole('option', { name: 'Archive while selected', exact: true }).click()
		await expect(
			main.getByRole('button', { name: 'Remove Archive while selected', exact: true })
		).toBeVisible()
		await page.evaluate(async (id) => {
			const { app, db } = window.workspaceSettingsTest
			await db.update(app.tags, id, { archivedAt: new Date() }).wait({ tier: 'global' })
		}, tagId)
		await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(
			main.getByRole('alert').filter({ hasText: 'Could not save Transaction.' })
		).toHaveText('Could not save Transaction.')
		const partial = await page.evaluate(async (organizationId) => {
			const { app, db } = window.workspaceSettingsTest
			return (
				await db.all(app.transactions.where({ organizationId, memo: 'Retry tagged entry' }), {
					tier: 'remote'
				})
			).length
		}, organizationId)
		expect(partial).toBe(0)
		await expect(main.getByLabel('Amount', { exact: true })).toHaveValue('5')
		await main.getByRole('button', { name: 'Remove Archive while selected', exact: true }).click()
		await tags.fill('Replacement tag')
		await tags.press('Enter')
		await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(page).toHaveURL(`/expenses?workspace=${organizationId}`)
		await expect
			.poll(() =>
				page.evaluate(async (organizationId) => {
					const { app, db } = window.workspaceSettingsTest
					const transaction = await db.one(
						app.transactions.where({ organizationId, memo: 'Retry tagged entry' }),
						{ tier: 'remote' }
					)
					if (!transaction) return []
					const links = await db.all(app.transactionTags.where({ transactionId: transaction.id }), {
						tier: 'remote'
					})
					const tags = await db.all(app.tags.where({ organizationId }), { tier: 'remote' })
					return links.map((link) => tags.find((tag) => tag.id === link.tagId)?.name).sort()
				}, organizationId)
			)
			.toEqual(['Replacement tag'])
	}
)

test(
	'transaction tags reset on workspace changes and save new categorized tags offline',
	{ tag: ['@transactions', '@tags', '@workflow-completion', '@workspaces'] },
	async ({ page, context }) => {
		await start(page)
		const firstId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const fixture = await page.evaluate(async (organizationId) => {
			const { app, db, userId } = window.workspaceSettingsTest
			await db
				.insert(app.accounts, {
					organizationId,
					name: 'First tag account',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.tags, { organizationId, name: 'First workspace tag', kind: 'expense' })
				.wait({ tier: 'global' })
			const org = await db
				.insert(app.organizations, {
					name: 'Offline tag workspace',
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
			const account = await db
				.insert(app.accounts, {
					organizationId: org.id,
					name: 'Offline tag account',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const category = await db
				.insert(app.categories, {
					organizationId: org.id,
					name: 'Offline tag category',
					kind: 'expense',
					isSystem: false
				})
				.wait({ tier: 'global' })
			return { organizationId: org.id, accountId: account.id, categoryId: category.id }
		}, firstId)
		await navigateSidebar(page, 'Expenses')
		await page.getByRole('link', { name: 'Add Expenses', exact: true }).click()
		const main = page.getByRole('main')
		const tags = main
			.getByRole('combobox', { name: 'Tags', exact: true })
			.or(main.getByRole('textbox', { name: 'Tags', exact: true }))
		await tags.fill('First workspace')
		await page.getByRole('option', { name: 'First workspace tag', exact: true }).click()
		await selectWorkspace(
			page.getByLabel('Current Workspace', { exact: true }),
			fixture.organizationId
		)
		await main.getByRole('link', { name: 'Add Expenses', exact: true }).click()
		await expect(tags).toHaveValue('')
		await expect(main.getByRole('button', { name: /^Remove / })).toHaveCount(0)
		await tags.fill('First workspace')
		await expect(
			page.getByRole('option', { name: 'First workspace tag', exact: true })
		).toHaveCount(0)
		await main.getByLabel('Account', { exact: true }).selectOption(fixture.accountId)
		await main.getByLabel('Category', { exact: true }).selectOption(fixture.categoryId)
		await main.getByLabel('Amount', { exact: true }).fill('3')
		await main.getByLabel('Memo (additional notes)', { exact: true }).fill('Offline tag entry')
		await tags.fill('Offline new tag')
		await tags.press('Enter')
		await context.setOffline(true)
		try {
			await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await expect(page).toHaveURL(`/expenses?workspace=${fixture.organizationId}`)
		} finally {
			await context.setOffline(false)
		}
		await expect
			.poll(() =>
				page.evaluate(async (fixture) => {
					const { app, db } = window.workspaceSettingsTest
					const transaction = await db.one(
						app.transactions.where({
							organizationId: fixture.organizationId,
							memo: 'Offline tag entry'
						}),
						{ tier: 'remote' }
					)
					const tag = await db.one(
						app.tags.where({ organizationId: fixture.organizationId, name: 'Offline new tag' }),
						{ tier: 'remote' }
					)
					if (!transaction || !tag) return null
					const links = await db.all(app.transactionTags.where({ transactionId: transaction.id }), {
						tier: 'remote'
					})
					return { categoryId: tag.categoryId, tags: links.map((link) => link.tagId) }
				}, fixture)
			)
			.toEqual({ categoryId: fixture.categoryId, tags: [expect.any(String)] })
	}
)
