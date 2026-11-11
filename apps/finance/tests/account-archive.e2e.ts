import { expect, test } from '@playwright/test'
import { openAccountActions, openCreationModal } from './helpers/ui.js'

test(
	'archives the chosen account locally, preserves other accounts, and survives reload',
	{ tag: ['@account-archive', '@accounts'] },
	async ({ page, context }) => {
		await page.goto('/accounts')
		await expect(
			page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true }).first()
		).toBeEnabled()
		for (const name of ['Archive checking', 'Keep savings']) {
			const dialog = await openCreationModal(page, 'Add Account')
			await dialog.getByLabel('Account name', { exact: true }).fill(name)
			await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
			await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
			await expect(dialog.getByRole('status')).toContainText(name)
			await dialog.getByRole('button', { name: 'Close', exact: true }).click()
			await expect(dialog).not.toBeVisible()
		}
		const main = page.getByRole('main')
		const accountsTable = main.getByRole('table', { name: 'Accounts', exact: true })
		for (const name of ['Archive checking', 'Keep savings']) {
			const row = accountsTable.getByRole('row').filter({ hasText: name })
			await expect(row.getByRole('cell').nth(3)).toHaveText('$0.00')
		}
		const actions = await openAccountActions(page, 'Archive checking')
		const archive = actions.getByRole('button', { name: 'Archive', exact: true })
		await expect(archive).toBeEnabled()
		// Archiving is a local write and must remain useful offline.
		await context.setOffline(true)
		await archive.click()
		await expect(main.getByRole('status').filter({ hasText: 'Archive checking' })).toHaveText(
			'Account Archive checking archived.'
		)
		await expect(archive).toHaveCount(0)
		await expect(
			main.getByRole('button', { name: 'Manage Keep savings', exact: true })
		).toBeEnabled()
		await context.setOffline(false)
		await page.reload()
		await expect(main.getByRole('table', { name: 'Accounts', exact: true })).toBeVisible()
		await expect(
			main.getByRole('button', { name: 'Manage Archive checking', exact: true })
		).toHaveCount(0)
		await expect(
			main.getByRole('button', { name: 'Manage Keep savings', exact: true })
		).toBeEnabled()
	}
)
