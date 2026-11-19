import { financeFixture } from './helpers/worker-fixture.js'
import { openCreationModal, closeCreationModal } from './helpers/ui.js'
import { expect, test, type Page } from '@playwright/test'

async function addAccount(page: Page, name: string) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	await financeFixture(page, 'account-order.e2e:9', name)
	await expect(page.getByRole('main').getByRole('cell', { name, exact: true })).toBeVisible()
}

async function openAccounts(page: Page) {
	const disclosure = page
		.locator('aside details')
		.filter({ has: page.locator('summary', { hasText: 'Accounts' }) })
	if ((await disclosure.getAttribute('open')) === null) await disclosure.locator('summary').click()
	return disclosure
}

test(
	'account order controls preserve selection and persisted order',
	{ tag: ['@accounts'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 })
		for (const name of ['Alpha', 'Bravo', 'Charlie']) await addAccount(page, name)
		const accounts = await openAccounts(page)
		const names = accounts.getByRole('checkbox')
		await expect(names).toHaveCount(4)
		await expect(accounts.getByRole('button', { name: /Move .* (up|down)/ })).toHaveCount(0)
		await accounts.getByRole('checkbox', { name: 'Alpha', exact: true }).uncheck()
		await accounts.getByRole('button', { name: 'Edit Order', exact: true }).click()
		await expect(
			accounts.getByRole('button', { name: 'Move Alpha up', exact: true })
		).toBeDisabled()
		await expect(
			accounts.getByRole('button', { name: 'Move Charlie down', exact: true })
		).toBeDisabled()
		await accounts.getByRole('button', { name: 'Move Charlie up', exact: true }).click()
		await accounts.getByRole('button', { name: 'Move Charlie up', exact: true }).click()
		await expect(accounts.locator('li.account-filter label')).toHaveText([
			'All Accounts',
			'Charlie',
			'Alpha',
			'Bravo'
		])
		await expect(accounts.getByRole('checkbox', { name: 'Alpha', exact: true })).not.toBeChecked()
		await expect(
			accounts.getByRole('button', { name: 'Move Charlie up', exact: true })
		).toBeDisabled()
		await accounts.getByRole('button', { name: 'Done', exact: true }).click()
		await expect(accounts.getByRole('button', { name: /Move .* (up|down)/ })).toHaveCount(0)

		await page.reload()
		await openAccounts(page)
		await expect(accounts.locator('li.account-filter label')).toHaveText([
			'All Accounts',
			'Charlie',
			'Alpha',
			'Bravo'
		])
		await expect(accounts.getByRole('button', { name: 'Edit Order', exact: true })).toBeVisible()
		await addAccount(page, 'Aaron')
		await openAccounts(page)
		await expect(accounts.locator('li.account-filter label')).toHaveText([
			'All Accounts',
			'Charlie',
			'Alpha',
			'Bravo',
			'Aaron'
		])
	}
)

test(
	'single account hides ordering and storage failure still allows session ordering',
	{ tag: ['@accounts'] },
	async ({ page }) => {
		await addAccount(page, 'Alpha')
		await financeFixture(page, 'failPreferencesStorage')
		const accounts = await openAccounts(page)
		await expect(accounts.getByRole('button', { name: 'Edit Order', exact: true })).toHaveCount(0)
		await expect(accounts.getByRole('button', { name: /Move .* (up|down)/ })).toHaveCount(0)
		// Client navigation keeps the workspace integration and its in-memory preference alive.
		await accounts.getByRole('link', { name: 'Manage Accounts', exact: true }).click()
		const modal = await openCreationModal(page, 'Add Account')
		await modal.getByLabel('Account name', { exact: true }).fill('Bravo')
		await modal.getByLabel('Account type', { exact: true }).selectOption('bank')
		await modal.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(modal.getByRole('status')).toContainText('Bravo')
		await closeCreationModal(page)
		await expect(accounts.getByRole('checkbox', { name: 'Bravo', exact: true })).toBeVisible()
		await accounts.getByRole('button', { name: 'Edit Order', exact: true }).click()
		await accounts.getByRole('button', { name: 'Move Bravo up', exact: true }).click()
		await expect(
			accounts.getByRole('button', { name: 'Move Bravo up', exact: true })
		).toBeDisabled()
		await expect(accounts.getByRole('checkbox', { name: 'Bravo', exact: true })).toBeChecked()
	}
)

test(
	'workspace changes exit editing, isolate saved order and ignore archived accounts',
	{ tag: ['@workspaces', '@accounts'] },
	async ({ page }) => {
		await addAccount(page, 'Alpha')
		await addAccount(page, 'Bravo')
		const accounts = await openAccounts(page)
		const settings = page
			.locator('aside details')
			.filter({ has: page.locator('summary', { hasText: 'Settings' }) })
		await settings.locator('summary').click()
		const selector = page.getByLabel('Current Workspace', { exact: true })
		const originalId = await selector.inputValue()
		const otherId = await financeFixture(page, 'account-order.e2e:139')
		await accounts.getByRole('button', { name: 'Edit Order', exact: true }).click()
		await accounts.getByRole('button', { name: 'Move Bravo up', exact: true }).click()
		await expect(selector.locator(`option[value="${otherId}"]`)).toHaveCount(1)
		await selector.selectOption(otherId)
		await expect(accounts.getByRole('button', { name: 'Edit Order', exact: true })).toBeVisible()
		await expect(accounts.locator('li.account-filter label')).toHaveText([
			'All Accounts',
			'Delta',
			'Echo'
		])
		await accounts.getByRole('button', { name: 'Edit Order', exact: true }).click()
		await accounts.getByRole('button', { name: 'Move Echo up', exact: true }).click()
		await selector.selectOption(originalId)
		await expect(accounts.getByRole('button', { name: 'Edit Order', exact: true })).toBeVisible()
		await expect(accounts.locator('li.account-filter label')).toHaveText([
			'All Accounts',
			'Bravo',
			'Alpha'
		])
		await selector.selectOption(otherId)
		await expect(accounts.locator('li.account-filter label')).toHaveText([
			'All Accounts',
			'Echo',
			'Delta'
		])
	}
)

for (const route of ['/expenses/new', '/income/new']) {
	test(
		`direct navigation to ${route} defaults to the saved first account`,
		{ tag: ['@accounts'] },
		async ({ page }) => {
			await addAccount(page, 'Alpha')
			await addAccount(page, 'Bravo')
			const accounts = await openAccounts(page)
			await accounts.getByRole('button', { name: 'Edit Order', exact: true }).click()
			await accounts.getByRole('button', { name: 'Move Bravo up', exact: true }).click()
			await accounts.getByRole('button', { name: 'Done', exact: true }).click()
			await page.goto(route)
			await expect(
				page.getByLabel('Account', { exact: true }).locator('option:checked')
			).toHaveText('Bravo · USD')
		}
	)
}
