import { financeFixture } from './worker-fixture.js'
import { expect, test as base, type ConsoleMessage, type Page } from '@playwright/test'
import { prepareSidebar, navigateSidebar } from './ui.js'

export const test = base.extend<{ ownershipWarnings: string[] }>({
	ownershipWarnings: [
		async ({ page }, use) => {
			const warnings: string[] = []
			const capture = (message: ConsoleMessage) => {
				if (/ownership_invalid_(mutation|binding)/.test(message.text()))
					warnings.push(message.text())
			}
			page.on('console', capture)
			try {
				await use(warnings)
			} finally {
				page.off('console', capture)
				expect(warnings, 'Svelte ownership warnings').toEqual([])
			}
		},
		{ auto: true }
	]
})

declare global {
	interface Window {
		workspaceSettingsTest: {
			db: ReturnType<typeof import('jazz-tools/svelte').getDb>
			app: typeof import('../../src/lib/queries.js').app
			userId: string
		}
	}
}

export async function installWorkspaceSettingsTest(page: Page) {
	await expect
		.poll(async () => financeFixture(page, 'helpers/workspace:38'), { timeout: 30_000 })
		.toBe(true)
	await financeFixture(page, 'helpers/workspace:48')
}

export async function start(page: Page) {
	await page.goto('/')
	const selector = page.getByLabel('Current Workspace', { exact: true })
	await expect(selector).not.toHaveValue('')
	await prepareSidebar(page)
	await navigateSidebar(page, 'Workspaces')
	await expect(page.getByRole('textbox', { name: 'Workspace name', exact: true })).toBeVisible()
	await installWorkspaceSettingsTest(page)
}
