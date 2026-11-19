import { expect, test } from '@playwright/test'
import { openCreationModal } from './helpers/ui.js'

test(
	'existing account modal retains validation, draft dismissal, save feedback and fresh reopen through the scoped owner',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		test.setTimeout(60_000)
		await page.goto('/accounts')
		const trigger = page
			.getByRole('main')
			.getByRole('button', { name: 'Add Account', exact: true })
			.first()
		await expect(trigger).toBeEnabled({ timeout: 30_000 })
		await trigger.click()
		const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
		const name = dialog.getByLabel('Account name', { exact: true })
		await name.fill('   ')
		await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
		await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(dialog.getByRole('alert')).toBeVisible()
		await name.fill('Presentation checking')
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(dialog).not.toBeVisible()
		await trigger.click()
		await expect(name).toHaveValue('Presentation checking')
		await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText('Presentation checking')
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(
			page.getByRole('main').getByRole('cell', { name: 'Presentation checking', exact: true })
		).toBeVisible()
		await trigger.click()
		await expect(name).toHaveValue('')
	}
)

test(
	'shared edit mode disables unchanged workspace saves, preserves stable labels and persists offline',
	{ tag: ['@workspaces'] },
	async ({ page, context }) => {
		test.setTimeout(60_000)
		await page.goto('/settings/workspace')
		const creation = await openCreationModal(page, 'Create Workspace')
		await creation.getByLabel('Workspace name', { exact: true }).fill('Form presentation workspace')
		await creation.getByRole('button', { name: 'Create Workspace', exact: true }).click()
		await expect(creation.getByRole('status')).toHaveText('Workspace saved.')
		const workspaceHref = await page
			.getByRole('link', { name: 'Open Workspace: Form presentation workspace', exact: true })
			.getAttribute('href')
		if (!workspaceHref) throw new Error('Missing created workspace link')
		const workspaceId = new URL(workspaceHref, 'http://localhost').searchParams.get('workspace')
		if (!workspaceId) throw new Error('Missing created workspace ID')
		await page.goto(`/settings/workspace?workspace=${workspaceId}`)
		const name = page
			.getByRole('main')
			.getByRole('textbox', { name: 'Workspace name', exact: true })
		await expect(name).toBeEditable({ timeout: 30_000 })
		const save = page.getByRole('main').getByRole('button', { name: 'Save', exact: true })
		await expect(name).toBeEditable({ timeout: 30_000 })
		const original = await name.inputValue()
		await expect(save).toBeDisabled()
		await name.fill('A changed name')
		await expect(save).toBeEnabled()
		await name.fill(original)
		await expect(save).toBeDisabled()
		await name.fill(`  ${original}  `)
		await expect(save).toBeDisabled()
		await name.fill('   ')
		await expect(save).toBeEnabled()
		await save.click()
		await expect(
			page.getByRole('main').getByRole('alert').filter({ hasText: 'Enter Workspace name' })
		).toHaveText('Enter Workspace name')
		await name.fill('Offline edit mode workspace')
		await expect(save).toBeEnabled()
		await context.setOffline(true)
		await save.click()
		await expect(
			page.getByRole('main').getByRole('status').filter({ hasText: 'Workspace settings saved.' })
		).toHaveText('Workspace settings saved.')
		await expect(save).toHaveText('Save')
		await expect(save).toBeDisabled()
		await expect(name).toBeEditable()
		await context.setOffline(false)
		await page.reload()
		await expect(name).toHaveValue('Offline edit mode workspace')
		await expect(save).toBeDisabled()
		await name.fill('Another edit')
		await expect(save).toBeEnabled()
	}
)
