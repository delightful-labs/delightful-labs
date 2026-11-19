import { financeFixture } from '../helpers/worker-fixture.js'
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
		const secondId = await financeFixture(page, 'features/categories.e2e:47')
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
		const fixture = await financeFixture(page, 'features/categories.e2e:93', organizationId)
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
		const systemOutcome = await financeFixture(
			page,
			'features/categories.e2e:164',
			fixture.systemId
		)
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
			.poll(() => financeFixture(page, 'features/categories.e2e:186', fixture))
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
				const subjectId = await financeFixture(subject, 'features/categories.e2e:226')
				const categoryId = await financeFixture(page, 'features/categories.e2e:227', {
					organizationId,
					subjectId,
					role
				})
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
					const outcomes = await financeFixture(subject, 'features/categories.e2e:275', {
						organizationId,
						categoryId
					})
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
					.poll(() => financeFixture(page, 'features/categories.e2e:322', categoryId))
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
			const subjectId = await financeFixture(subject, 'features/categories.e2e:347')
			await financeFixture(page, 'features/categories.e2e:348', { organizationId, subjectId })
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
