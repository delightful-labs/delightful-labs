import { financeFixture } from './helpers/worker-fixture.js'
import { expect, test } from '@playwright/test'
import { openSidebarSection } from './helpers/ui.js'

for (const width of [390, 1280]) {
	test(`sidebar balances match the table and update independently of filters at ${width}px`, async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width, height: 900 })
		await page.goto('/accounts')
		await expect(
			page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
		).toBeEnabled()
		const seed = await financeFixture(page, 'sidebar-balances.e2e:14')
		const table = page.getByRole('main').getByRole('table', { name: 'Accounts', exact: true })
		for (const [name, amount] of [
			['Positive', '$74.75'],
			['Negative', '-$12.34'],
			['Zero', '$0.00'],
			['TZS', 'TSh 45.00']
		] satisfies [string, string][]) {
			await expect(
				table
					.getByRole('row')
					.filter({ has: page.getByRole('cell', { name, exact: true }) })
					.getByRole('cell')
					.nth(3)
			).toHaveText(amount)
		}
		const accounts = await openSidebarSection(page, 'Accounts')
		const balance = (name: string) =>
			accounts
				.locator('li.account-filter')
				.filter({ has: page.getByRole('checkbox', { name, exact: true }) })
				.locator('[title="Calculated balance"]')
		for (const [name, amount] of [
			['Positive', '$74.75'],
			['Negative', '-$12.34'],
			['Zero', '$0.00'],
			['TZS', 'TSh 45.00']
		] satisfies [string, string][]) {
			await expect(balance(name)).toHaveText(amount)
		}
		await expect(balance('Positive')).toHaveCSS('font-size', '12px')
		await accounts.getByRole('checkbox', { name: 'Positive', exact: true }).uncheck()
		await expect(balance('Positive')).toHaveText('$74.75')
		await context.setOffline(true)
		await financeFixture(page, 'sidebar-balances.e2e:90', seed.transactionId)
		await expect(balance('Positive')).toHaveText('$174.75')
		await context.setOffline(false)
		await page.reload()
		await openSidebarSection(page, 'Accounts')
		await expect(balance('Positive')).toHaveText('$174.75')
		const originalWorkspace = new URL(page.url()).searchParams.get('workspace')
		if (!originalWorkspace) throw new Error('Missing current workspace')
		const otherId = await financeFixture(page, 'sidebar-balances.e2e:107')
		const settings = await openSidebarSection(page, 'Settings')
		const selector = settings.getByLabel('Current Workspace', { exact: true })
		await expect(selector.locator(`option[value="${otherId}"]`)).toHaveCount(1)
		await selector.selectOption(otherId)
		await expect(balance('Other ledger')).toHaveText('$0.00')
		await expect(balance('Positive')).toHaveCount(0)
		await selector.selectOption(originalWorkspace)
		await expect(balance('Positive')).toHaveText('$174.75')
		const sidebar = page.locator('aside.site-drawer')
		await expect(sidebar.getByText('Online', { exact: true })).toBeVisible()
		await context.setOffline(true)
		await expect(sidebar.getByText('Offline', { exact: true })).toBeVisible()
		await context.setOffline(false)
		await expect(sidebar.getByText('Online', { exact: true })).toBeVisible()
	})
}
