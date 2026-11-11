import { expect, test } from '@playwright/test'
import { openCreationModal } from './helpers/ui.js'

const fixture = '/__form-presentation'

// Supply the test-only document through Playwright. Vite transforms the entry
// module and actual shared components; no application route is introduced.
test.beforeEach(async ({ page }) => {
	await page.route('**/__form-presentation*', (route) =>
		route.fulfill({
			contentType: 'text/html',
			// Shared form controllers now import the environment-gated inspector.
			// This standalone document needs Kit's generated env bootstrap before
			// importing those controllers, just as the normal app entry does.
			body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Form fixture</title></head><body><script type="module">
import '/.svelte-kit/generated/dev/env/service-worker.js';
import '/src/lib/testing/form-presentation/form-presentation-entry.ts';
</script></body></html>`
		})
	)
})

test(
	'scoped fields react to access; accepted reset rebuilds fields and busy reset preserves them',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await page.goto(fixture)
		const name = page.getByRole('textbox', { name: 'Name', exact: true })
		await expect(name).toBeEnabled()
		await name.fill('Draft')
		await name.evaluate((node) => node.setAttribute('data-original', 'true'))
		await page.getByRole('button', { name: 'Toggle access', exact: true }).click()
		await expect(name).toBeDisabled()
		await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
		await page.getByRole('button', { name: 'Toggle access', exact: true }).click()
		await expect(name).toBeEnabled()
		await page.getByRole('button', { name: 'Reset draft', exact: true }).click()
		await expect(name).toHaveValue('')
		await expect(name).not.toHaveAttribute('data-original')
		await expect(page.getByTestId('revision')).toHaveText('1')
		await name.fill('Pending')
		await name.evaluate((node) => node.setAttribute('data-original', 'busy'))
		await page.getByRole('button', { name: 'Save draft', exact: true }).click()
		await expect(page.getByTestId('activity')).toHaveText('operating')
		await expect(name).toBeDisabled()
		await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true')
		await page.getByRole('button', { name: 'Request reset', exact: true }).click()
		await expect(name).toHaveValue('Pending')
		await expect(name).toHaveAttribute('data-original', 'busy')
		await expect(page.getByTestId('revision')).toHaveText('1')
		await page.getByRole('button', { name: 'Finish write', exact: true }).click()
		await expect(page.getByRole('status')).toHaveText('succeeded')
		await expect(page.locator('form')).toHaveAttribute('aria-busy', 'false')
		await page.getByRole('button', { name: 'Reset draft', exact: true }).click()
		await expect(name).toHaveValue('')
		await expect(name).toBeEnabled()
	}
)

test('modal preserves drafts across Escape/backdrop; closes and reopens issued work without cancellation; renders void success', async ({
	page
}) => {
	await page.goto(`${fixture}?modal`)
	const trigger = page.getByRole('button', { name: 'Save draft', exact: true }).first()
	const dialog = page.getByRole('dialog', { name: 'Save draft', exact: true })
	await trigger.click()
	const name = dialog.getByRole('textbox', { name: 'Name', exact: true })
	await name.fill('Keep this draft')
	await page.keyboard.press('Escape')
	await expect(dialog).not.toBeVisible()
	await trigger.click()
	await expect(name).toHaveValue('Keep this draft')
	await page.mouse.click(2, 2)
	await expect(dialog).not.toBeVisible()
	await trigger.click()
	await expect(name).toHaveValue('Keep this draft')
	await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(dialog.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(dialog).not.toBeVisible()
	await expect(page.getByTestId('activity')).toHaveText('operating')
	await trigger.click()
	await expect(name).toHaveValue('Keep this draft')
	await expect(name).toBeDisabled()
	await expect(page.getByTestId('starts')).toHaveText('1')
	await expect(page.getByTestId('cancellations')).toHaveText('0')
	// Settle via the fixture control while the native dialog makes the background inert.
	await page.getByRole('button', { name: 'Finish write', exact: true }).evaluate((node) => {
		if (!(node instanceof HTMLElement)) throw new Error('Expected button')
		node.click()
	})
	await expect(dialog.getByRole('status')).toHaveText('succeeded')
	await expect(dialog.getByRole('textbox')).toHaveCount(0)
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await trigger.click()
	await expect(name).toHaveValue('')
	await expect(name).toBeEnabled()
	await expect(page.getByTestId('starts')).toHaveText('1')
})

test(
	'scope replacement closes the modal and resets its visible draft',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await page.goto(`${fixture}?modal`)
		const trigger = page.getByRole('button', { name: 'Save draft', exact: true }).first()
		const dialog = page.getByRole('dialog')
		await trigger.click()
		await dialog.getByRole('textbox').fill('Old workspace')
		await page.getByRole('button', { name: 'Replace scope', exact: true }).evaluate((node) => {
			if (!(node instanceof HTMLElement)) throw new Error('Expected button')
			node.click()
		})
		await expect(dialog).not.toBeVisible()
		await trigger.click()
		await expect(dialog.getByRole('textbox')).toHaveValue('')
		await expect(page.getByTestId('starts')).toHaveText('0')
	}
)

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

test('submission reports render validation and operating activity through the shared controller', async ({
	page
}) => {
	await page.goto(`${fixture}?validation`)
	const name = page.getByRole('textbox', { name: 'Name', exact: true })
	await expect(name).toBeEnabled()
	await name.fill('Reported progress')
	await page.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(page.getByTestId('activity')).toHaveText('validating')
	await expect(page.getByTestId('starts')).toHaveText('0')
	await expect(name).toBeDisabled()
	await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true')
	await page.getByRole('button', { name: 'Finish validation', exact: true }).click()
	await expect(page.getByTestId('activity')).toHaveText('operating')
	await expect(page.getByTestId('starts')).toHaveText('1')
	await expect(name).toBeDisabled()
	await page.getByRole('button', { name: 'Finish write', exact: true }).click()
	await expect(page.getByTestId('activity')).toHaveText('idle')
	await expect(page.getByRole('status')).toHaveText('succeeded')
	await expect(page.locator('form')).toHaveAttribute('aria-busy', 'false')
})

test(
	'scope replacement during reported validation waits for cleanup without starting a write',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await page.goto(`${fixture}?validation`)
		const name = page.getByRole('textbox', { name: 'Name', exact: true })
		await expect(name).toBeEnabled()
		await name.fill('Old scope')
		await page.getByRole('button', { name: 'Save draft', exact: true }).click()
		await expect(page.getByTestId('activity')).toHaveText('validating')
		await page.getByRole('button', { name: 'Replace scope', exact: true }).click()
		await expect(page.getByTestId('activity')).toHaveText('settling')
		await expect(page.getByTestId('starts')).toHaveText('0')
		await page.getByRole('button', { name: 'Finish validation', exact: true }).click()
		await expect(page.getByTestId('activity')).toHaveText('idle')
		await expect(page.getByTestId('starts')).toHaveText('0')
		await expect(page.getByRole('status')).toHaveCount(0)
		await expect(name).toHaveValue('')
		await expect(name).toBeEnabled()
	}
)

test('readiness withdrawal disables submission until a current report arrives', async ({
	page
}) => {
	await page.goto(fixture)
	const name = page.getByRole('textbox', { name: 'Name', exact: true })
	const save = page.getByRole('button', { name: 'Save draft', exact: true })
	await expect(name).toBeEnabled()
	await name.fill('Waiting for fresh readiness')
	await page.getByRole('button', { name: 'Hold readiness', exact: true }).click()
	await expect(page.getByTestId('readiness')).toHaveText('observing')
	await expect(name).toBeDisabled()
	await expect(save).toBeDisabled()
	await expect(page.getByTestId('starts')).toHaveText('0')
	await page.getByRole('button', { name: 'Release readiness', exact: true }).click()
	await expect(page.getByTestId('readiness')).toHaveText('ready')
	await expect(name).toBeEnabled()
	await expect(name).toHaveValue('Waiting for fresh readiness')
	await save.click()
	await expect(page.getByTestId('starts')).toHaveText('1')
	await page.getByRole('button', { name: 'Finish write', exact: true }).click()
	await expect(page.getByRole('status')).toHaveText('succeeded')
})

test('readiness failure drains pending work before a fresh watcher can recover', async ({
	page
}) => {
	await page.goto(fixture)
	const name = page.getByRole('textbox', { name: 'Name', exact: true })
	const retry = page.getByRole('button', { name: 'Retry readiness', exact: true })
	await expect(name).toBeEnabled()
	await name.fill('Pending original write')
	await page.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(page.getByTestId('starts')).toHaveText('1')
	await page.getByRole('button', { name: 'Fail readiness', exact: true }).click()
	await expect(page.getByTestId('readiness')).toHaveText('failed')
	await expect(page.getByTestId('activity')).toHaveText('settling')
	await expect(retry).toBeDisabled()
	await page.getByRole('button', { name: 'Repair readiness', exact: true }).click()
	await expect(page.getByTestId('readiness')).toHaveText('failed')
	await page.getByRole('button', { name: 'Finish write', exact: true }).click()
	await expect(page.getByTestId('activity')).toHaveText('idle')
	await expect(retry).toBeEnabled()
	await retry.click()
	await expect(page.getByTestId('readiness')).toHaveText('ready')
	await expect(name).toBeEnabled()
	await expect(page.getByTestId('starts')).toHaveText('1')
})
