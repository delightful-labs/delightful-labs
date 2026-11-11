import { expect } from '@playwright/test'
import { test, start } from '../helpers/workspace.js'
import { openSidebarSection, selectWorkspace } from '../helpers/ui.js'

test(
	'sidebar navigation preserves the selected workspace and database session',
	{ tag: ['@workspaces', '@navigation'] },
	async ({ page }) => {
		await start(page)
		const workspaceId = await page.evaluate(async () => {
			const { app, db, userId } = window.workspaceSettingsTest
			const workspace = await db
				.insert(app.organizations, {
					name: 'Navigation workspace',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: userId
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.organizationMembers, {
					organizationId: workspace.id,
					userId,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
			return workspace.id
		})
		const selector = page.getByLabel('Current Workspace', { exact: true })
		await expect(selector.locator(`option[value="${workspaceId}"]`)).toHaveCount(1)
		await selectWorkspace(selector, workspaceId)
		await expect(page).toHaveURL(`/settings/workspace?workspace=${workspaceId}`)
		await expect(page.getByRole('textbox', { name: 'Workspace name', exact: true })).toHaveValue(
			'Navigation workspace'
		)
		const navigation = page.getByRole('navigation', { name: 'Main navigation' })
		await navigation.getByRole('link', { name: 'Overview', exact: true }).click()
		await expect(page).toHaveURL(`/?workspace=${workspaceId}`)
		await openSidebarSection(page, 'Settings')
		const link = navigation.getByRole('link', { name: 'Workspaces', exact: true })
		await expect(link).toHaveAttribute('href', `/settings/workspace?workspace=${workspaceId}`)
		await link.click()
		await expect(page).toHaveURL(`/settings/workspace?workspace=${workspaceId}`)
		await expect(selector).toHaveValue(workspaceId)
		await expect(page.getByRole('textbox', { name: 'Workspace name', exact: true })).toHaveValue(
			'Navigation workspace'
		)
		const save = page.getByRole('button', { name: 'Save', exact: true })
		await expect(save).toBeDisabled()
		await page
			.getByRole('textbox', { name: 'Workspace name', exact: true })
			.fill('Navigation workspace edited')
		await expect(save).toBeEnabled()
		await page
			.getByRole('textbox', { name: 'Workspace name', exact: true })
			.fill('Navigation workspace')
		await expect(save).toBeDisabled()
		// The binding survives only client navigation and still points to the active client.
		expect(
			await page.evaluate(async () => {
				const sessionPath = '/src/lib/runtime/jazz-session.ts'
				const { getCurrentJazzSession }: typeof import('../../src/lib/runtime/jazz-session.js') =
					await import(sessionPath)
				return window.workspaceSettingsTest.db === getCurrentJazzSession()?.getSnapshot().client?.db
			})
		).toBe(true)
	}
)

test(
	'overview navigation exposes income and expense links and preserves the workspace during navigation',
	{ tag: ['@workspaces', '@navigation'] },
	async ({ page }) => {
		await start(page)
		const workspaceId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		await page
			.getByRole('complementary', { name: 'Main navigation', exact: true })
			.getByRole('link', { name: 'Overview', exact: true })
			.click()
		await expect(page).toHaveTitle('Overview · Delightful Finance')
		const main = page.getByRole('main')
		const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true })
		await expect(main.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
		await expect(navigation.getByRole('link', { name: 'Expenses', exact: true })).toHaveAttribute(
			'href',
			`/expenses?workspace=${workspaceId}`
		)
		await expect(navigation.getByRole('link', { name: 'Income', exact: true })).toHaveAttribute(
			'href',
			`/income?workspace=${workspaceId}`
		)
		await navigation.getByRole('link', { name: 'Expenses', exact: true }).click()
		await expect(page).toHaveURL(`/expenses?workspace=${workspaceId}`)
		await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
		await page
			.getByRole('complementary', { name: 'Main navigation', exact: true })
			.getByRole('link', { name: 'Overview', exact: true })
			.click()
		await navigation.getByRole('link', { name: 'Income', exact: true }).click()
		await expect(page).toHaveURL(`/income?workspace=${workspaceId}`)
		await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
		await page
			.getByRole('complementary', { name: 'Main navigation', exact: true })
			.getByRole('link', { name: 'Overview', exact: true })
			.click()
		await expect(page).toHaveURL(`/?workspace=${workspaceId}`)
		await page.reload()
		await expect(main.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
	}
)
