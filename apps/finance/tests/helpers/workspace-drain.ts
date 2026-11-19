import { financeFixture } from './worker-fixture.js'
import { expect, type Page } from '@playwright/test'

/** Hold the acknowledgement of a real, already locally persisted SDK write. */
export async function holdWorkspaceWrite(page: Page, kind: 'transfer' | 'bank') {
	await financeFixture(page, 'installWorkspaceWrite', kind)
	return {
		status: () => financeFixture(page, 'workspaceWriteStatus'),
		release: () => financeFixture(page, 'releaseWorkspaceWrite'),
		restore: () => financeFixture(page, 'restoreWorkspaceWrite')
	}
}

export function machineErrors(page: Page) {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'warning' && message.text().includes('sent to stopped actor'))
			errors.push(message.text())
	})
	return errors
}

export async function ownRecoveryPhrase(page: Page) {
	const { navigateSidebar } = await import('./ui.js')
	await navigateSidebar(page, 'Account')
	await page.getByRole('button', { name: 'Show Recovery phrase', exact: true }).click()
	const phrase = await page.getByLabel('Your recovery phrase', { exact: true }).inputValue()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	return phrase
}

export async function requestRecovery(page: Page, phrase: string) {
	const { navigateSidebar } = await import('./ui.js')
	await navigateSidebar(page, 'Login')
	const input = page.getByLabel('Recovery phrase', { exact: true })
	await input.fill(phrase)
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	// The worker drains issued writes before restoring. Its mounted form clears
	// the phrase and disables new submissions throughout that wait.
	await expect(input).toHaveValue('')
	await expect(input).toBeDisabled()
	await expect(input.locator('xpath=ancestor::form').getByRole('button')).toBeDisabled()
}
