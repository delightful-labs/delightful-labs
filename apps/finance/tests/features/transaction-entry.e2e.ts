import { expect } from '@playwright/test'
import { test, start } from '../helpers/workspace.js'
import { selectWorkspace } from '../helpers/ui.js'

test(
	'transaction form shows the no-account message after its data loads',
	{ tag: ['@transactions', '@workflow-completion'] },
	async ({ page }) => {
		await page.goto('/expenses/new')
		const main = page.getByRole('main')
		await expect(
			main.getByRole('paragraph').filter({
				hasText: 'Add an account before recording a transaction.'
			})
		).toBeVisible()
		await expect(main.getByRole('button', { name: 'Save Transaction' })).toHaveCount(0)
	}
)

const formScenarios = [
	{ kind: 'expense', path: '/expenses/new', link: 'Expenses', memo: 'Form expense' },
	{ kind: 'income', path: '/income/new', link: 'Income', memo: 'Form check income' }
] satisfies { kind: 'expense' | 'income'; path: string; link: string; memo: string }[]

for (const scenario of formScenarios) {
	test(
		`transaction form ${scenario.kind} follows workspace options and saves`,
		{ tag: ['@transactions', '@workflow-completion', '@workspaces'] },
		async ({ page }) => {
			await start(page)
			const defaultCheckDate = await page.evaluate(() => {
				const now = new Date()
				return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
			})
			const firstWorkspaceId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const secondWorkspaceId = await page.evaluate(
				async ({ organizationId, kind }) => {
					const { app, db, userId } = window.workspaceSettingsTest
					const second = await db
						.insert(app.organizations, {
							name: 'Form workspace',
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
					await db
						.insert(app.accounts, {
							organizationId,
							name: 'Personal checking',
							kind: 'bank',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					await db
						.insert(app.categories, {
							organizationId,
							name: 'Personal category',
							kind,
							isSystem: false
						})
						.wait({ tier: 'global' })
					await db
						.insert(app.accounts, {
							organizationId: second.id,
							name: 'Business checking',
							kind: 'bank',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					const archivedAccount = await db
						.insert(app.accounts, {
							organizationId: second.id,
							name: 'Archived checking',
							kind: 'bank',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					await db
						.update(app.accounts, archivedAccount.id, { archivedAt: new Date() })
						.wait({ tier: 'global' })
					await db
						.insert(app.categories, {
							organizationId: second.id,
							name: 'Business category',
							kind,
							isSystem: false
						})
						.wait({ tier: 'global' })
					await db
						.insert(app.categories, {
							organizationId: second.id,
							name: 'Wrong kind category',
							kind: kind === 'expense' ? 'income' : 'expense',
							isSystem: false
						})
						.wait({ tier: 'global' })
					await db
						.insert(app.categories, {
							organizationId: second.id,
							name: 'Archived category',
							kind,
							isSystem: false,
							archivedAt: new Date()
						})
						.wait({ tier: 'global' })
					return second.id
				},
				{ organizationId: firstWorkspaceId, kind: scenario.kind }
			)
			await page
				.getByRole('navigation')
				.getByRole('link', { name: scenario.link, exact: true })
				.click()
			await page
				.getByRole('main')
				.getByRole('link', {
					name: scenario.kind === 'expense' ? 'Add Expenses' : 'Add Income',
					exact: true
				})
				.click()
			await expect(page).toHaveURL(`${scenario.path}?workspace=${firstWorkspaceId}`)
			const account = page.getByLabel('Account', { exact: true })
			const category = page.getByLabel('Category', { exact: true })
			await expect(account.locator('option')).toHaveText([
				'Select Account',
				'Personal checking · USD'
			])
			await expect(
				category.getByRole('option', { name: 'Personal category', exact: true })
			).toHaveCount(1)
			await page
				.getByLabel('Memo (additional notes)', { exact: true })
				.fill('Draft from previous workspace')
			await expect(page.getByLabel('Check number')).toBeHidden()
			await expect(page.getByLabel('Check date')).toBeHidden()
			if (scenario.kind === 'income') {
				await page.getByLabel('Payment method').selectOption('check')
				await page.getByLabel('Check number').fill('Previous workspace check')
				await page.getByLabel('Check date').fill('2026-10-12')
			}
			await selectWorkspace(
				page.getByLabel('Current Workspace', { exact: true }),
				secondWorkspaceId
			)
			await expect(page).toHaveURL(
				`${scenario.kind === 'income' ? '/income' : '/expenses'}?workspace=${secondWorkspaceId}`
			)
			await page
				.getByRole('main')
				.getByRole('link', {
					name: scenario.kind === 'income' ? 'Add Income' : 'Add Expenses',
					exact: true
				})
				.click()
			await expect(page).toHaveURL(`${scenario.path}?workspace=${secondWorkspaceId}`)
			await expect(account.locator('option')).toHaveText([
				'Select Account',
				'Business checking · USD'
			])
			await expect(category.locator('option')).toHaveText(['Select Category', 'Business category'])
			await expect(page.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue('')
			await account.selectOption({ label: 'Business checking · USD' })
			await category.selectOption({ label: 'Business category' })
			await page.getByLabel(/Amount/).fill('42.50')
			await page.getByLabel('Date', { exact: true }).fill('2026-10-13')
			await page.getByLabel('Memo (additional notes)', { exact: true }).fill(scenario.memo)
			if (scenario.kind === 'income') {
				await expect(page.getByLabel('Payment method')).toHaveValue('')
				await expect(page.getByLabel('Check number')).toBeHidden()
				await page.getByLabel('Payment method').selectOption('check')
				await expect(page.getByLabel('Check number')).toHaveValue('')
				await expect(page.getByLabel('Check date')).toHaveValue(defaultCheckDate)
				await expect(page.getByLabel('Check number')).toHaveAttribute('required', '')
				await expect(page.getByLabel('Check date')).toHaveAttribute('required', '')
				for (const method of ['cash', 'transfer', 'electronic']) {
					await page.getByLabel('Payment method').selectOption(method)
					await expect(page.getByLabel('Check number')).toBeHidden()
					await expect(page.getByLabel('Check date')).toBeHidden()
				}
				await page.getByLabel('Payment method').selectOption('check')
				await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				expect(
					await page
						.getByLabel('Check number')
						.evaluate((element: HTMLInputElement) => element.validity.valueMissing)
				).toBe(true)
				await page.getByLabel('Check number').fill('12345')
				await page.getByLabel('Check date').fill('')
				await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				expect(
					await page
						.getByLabel('Check date')
						.evaluate((element: HTMLInputElement) => element.validity.valueMissing)
				).toBe(true)
				await page.getByLabel('Check date').fill('2026-10-12')
				await page.getByLabel('Check number').fill(' ')
				await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				await expect(
					page
						.getByRole('main')
						.getByRole('alert')
						.filter({ hasText: 'Check the form and try again.' })
				).toHaveText('Check the form and try again.')
				await expect(page.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
					scenario.memo
				)
				await page.getByLabel('Check number').fill('12345')
				await page.getByLabel('Check date').fill('2026-10-12')
			}
			await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await expect(page).toHaveURL(
				`${scenario.kind === 'income' ? '/income' : '/expenses'}?workspace=${secondWorkspaceId}`
			)
			const saved = await page.evaluate(
				async ({ organizationId, memo }) => {
					const { app, db } = window.workspaceSettingsTest
					const rows = await db.all(app.transactions.where({ organizationId, memo }), {
						tier: 'remote'
					})
					const row = rows[0]
					return {
						rows,
						check: row?.checkId
							? await db.one(app.checks.where({ id: row.checkId }), { tier: 'remote' })
							: null
					}
				},
				{ organizationId: secondWorkspaceId, memo: scenario.memo }
			)
			expect(saved.rows).toHaveLength(1)
			expect(saved.rows[0]).toMatchObject({
				kind: scenario.kind,
				amountMinor: 4250,
				bookedOn: '2026-10-13'
			})
			if (scenario.kind === 'income') {
				expect(saved.rows[0]?.paymentMethod).toBe('check')
				expect(saved.check).toMatchObject({ checkNumber: '12345', checkDate: '2026-10-12' })
			} else expect(saved.check).toBeNull()
			await page.goto(`${scenario.path}?workspace=${secondWorkspaceId}`)
			await expect(page.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue('')
			await expect(account.locator('option')).toHaveText([
				'Select Account',
				'Business checking · USD'
			])
			if (scenario.kind === 'income') {
				await expect(page.getByLabel('Payment method')).toHaveValue('')
				await expect(page.getByLabel('Check number')).toBeHidden()
				await expect(page.getByLabel('Check date')).toBeHidden()
				await page.getByLabel('Payment method').selectOption('check')
				await expect(page.getByLabel('Check number')).toHaveValue('')
				await expect(page.getByLabel('Check date')).toHaveValue(defaultCheckDate)
			}
		}
	)
}

for (const scenario of formScenarios) {
	test(
		`default category ${scenario.kind} survives overrides, reset, and workspace switching`,
		{ tag: ['@transactions', '@workflow-completion', '@workspaces'] },
		async ({ page }) => {
			await start(page)
			const firstWorkspaceId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const fixture = await page.evaluate(
				async ({ organizationId, kind }) => {
					const { app, db, userId } = window.workspaceSettingsTest
					const system = await db.one(
						app.categories.where({ organizationId, kind, isSystem: true }),
						{ tier: 'remote' }
					)
					if (!system) throw new Error('System category is missing.')
					const account = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Default checking',
							kind: 'bank',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					const custom = await db
						.insert(app.categories, {
							organizationId,
							name: 'Custom category',
							kind,
							isSystem: false
						})
						.wait({ tier: 'global' })
					const second = await db
						.insert(app.organizations, {
							name: 'Defaults workspace',
							kind: 'business',
							ownerId: userId,
							defaultCurrency: 'USD'
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
					const secondAccount = await db
						.insert(app.accounts, {
							organizationId: second.id,
							name: 'Second checking',
							kind: 'bank',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					const secondSystem = await db
						.insert(app.categories, {
							organizationId: second.id,
							name: 'Renamed default',
							kind,
							isSystem: true
						})
						.wait({ tier: 'global' })
					return {
						systemId: system.id,
						accountId: account.id,
						customId: custom.id,
						secondWorkspaceId: second.id,
						secondAccountId: secondAccount.id,
						secondSystemId: secondSystem.id
					}
				},
				{ organizationId: firstWorkspaceId, kind: scenario.kind }
			)
			await page
				.getByRole('navigation')
				.getByRole('link', { name: scenario.link, exact: true })
				.click()
			await page
				.getByRole('main')
				.getByRole('link', {
					name: scenario.kind === 'expense' ? 'Add Expenses' : 'Add Income',
					exact: true
				})
				.click()
			const category = page.getByLabel('Category', { exact: true })
			await expect(category).toHaveValue(fixture.systemId)
			async function save(
				accountId: string,
				memo: string,
				organizationId: string,
				categoryId: string
			) {
				await page.getByLabel('Account', { exact: true }).selectOption(accountId)
				await page.getByLabel(/Amount/).fill('5.00')
				await page.getByLabel('Memo (additional notes)', { exact: true }).fill(memo)
				await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				await expect
					.poll(() =>
						page.evaluate(
							async ({ organizationId, memo }) => {
								const { app, db } = window.workspaceSettingsTest
								const rows = await db.all(app.transactions.where({ organizationId, memo }), {
									tier: 'remote'
								})
								return rows.map((row) => ({ categoryId: row.categoryId, kind: row.kind }))
							},
							{ organizationId, memo }
						)
					)
					.toEqual([{ categoryId, kind: scenario.kind }])
				await page
					.getByRole('main')
					.getByRole('link', {
						name: scenario.kind === 'expense' ? 'Add Expenses' : 'Add Income',
						exact: true
					})
					.click()
			}
			await save(fixture.accountId, 'Default transaction', firstWorkspaceId, fixture.systemId)
			await expect(category).toHaveValue(fixture.systemId)
			await category.selectOption(fixture.customId)
			await page.evaluate(
				async ({ organizationId, kind }) => {
					const { app, db } = window.workspaceSettingsTest
					await db
						.insert(app.categories, {
							organizationId,
							name: 'Live category',
							kind,
							isSystem: false
						})
						.wait({ tier: 'global' })
				},
				{ organizationId: firstWorkspaceId, kind: scenario.kind }
			)
			await expect(category.getByRole('option', { name: 'Live category' })).toHaveCount(1)
			await expect(category).toHaveValue(fixture.customId)
			await save(fixture.accountId, 'Custom transaction', firstWorkspaceId, fixture.customId)
			await expect(category).toHaveValue(fixture.systemId)
			const selector = page.getByLabel('Current Workspace', { exact: true })
			await selectWorkspace(selector, fixture.secondWorkspaceId)
			await page
				.getByRole('main')
				.getByRole('link', {
					name: scenario.kind === 'expense' ? 'Add Expenses' : 'Add Income',
					exact: true
				})
				.click()
			await expect(category).toHaveValue(fixture.secondSystemId)
			await save(
				fixture.secondAccountId,
				'Second default transaction',
				fixture.secondWorkspaceId,
				fixture.secondSystemId
			)
			await expect(category).toHaveValue(fixture.secondSystemId)
			await selectWorkspace(selector, firstWorkspaceId)
			await page
				.getByRole('main')
				.getByRole('link', {
					name: scenario.kind === 'expense' ? 'Add Expenses' : 'Add Income',
					exact: true
				})
				.click()
			await expect(category).toHaveValue(fixture.systemId)
		}
	)
}
