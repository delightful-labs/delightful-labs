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
			app: typeof import('../../src/lib/schema.js').app
			userId: string
		}
	}
}

export async function installWorkspaceSettingsTest(page: Page) {
	await expect
		.poll(
			async () =>
				page.evaluate(async () => {
					const path = '/src/lib/runtime/jazz-session.ts'
					const { getCurrentJazzSession }: typeof import('../../src/lib/runtime/jazz-session.js') =
						await import(path)
					const snapshot = getCurrentJazzSession()?.getSnapshot()
					return Boolean(snapshot?.client && snapshot.account)
				}),
			{ timeout: 30_000 }
		)
		.toBe(true)
	await page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Test session is not ready.')
		window.workspaceSettingsTest = {
			db: snapshot.client.db,
			app,
			userId: snapshot.account.id
		}
	})
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
