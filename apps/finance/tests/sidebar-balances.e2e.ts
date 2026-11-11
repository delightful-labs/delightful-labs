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
		const seed = await page.evaluate(async () => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			const [organization] = await db.all(app.organizations)
			if (!organization) throw new Error('Missing workspace')
			const organizationId = organization.id
			const categories = await db.all(app.categories.where({ organizationId }))
			const expense = categories.find((row) => row.kind === 'expense')
			const income = categories.find((row) => row.kind === 'income')
			if (!expense || !income) throw new Error('Missing categories')
			let transactionId = ''
			for (const [name, currency, amounts] of [
				['Positive', 'USD', [10000, -2525]],
				['Negative', 'USD', [-1234]],
				['Zero', 'USD', []],
				['TZS', 'TZS', [4500]]
			] satisfies [string, string, number[]][]) {
				const account = await db
					.insert(app.accounts, { organizationId, name, currency, kind: 'bank' })
					.wait({ tier: 'local' })
				for (const amount of amounts) {
					const row = await db
						.insert(app.transactions, {
							organizationId,
							accountId: account.id,
							currency,
							kind: amount < 0 ? 'expense' : 'income',
							categoryId: amount < 0 ? expense.id : income.id,
							amountMinor: Math.abs(amount),
							source: 'manual',
							bookedOn: '2026-10-18'
						})
						.wait({ tier: 'local' })
					if (name === 'Positive' && amount > 0) transactionId = row.id
				}
			}
			return { transactionId }
		})
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
		await page.evaluate(async (id) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			await db.update(app.transactions, id, { amountMinor: 20000 }).wait({ tier: 'local' })
		}, seed.transactionId)
		await expect(balance('Positive')).toHaveText('$174.75')
		await context.setOffline(false)
		await page.reload()
		await openSidebarSection(page, 'Accounts')
		await expect(balance('Positive')).toHaveText('$174.75')
		const originalWorkspace = new URL(page.url()).searchParams.get('workspace')
		if (!originalWorkspace) throw new Error('Missing current workspace')
		const otherId = await page.evaluate(async () => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const snapshot = getCurrentJazzSession()?.getSnapshot()
			if (!snapshot?.client || !snapshot.account) throw new Error('Missing session')
			const db = snapshot.client.db
			const workspace = await db
				.insert(app.organizations, {
					name: 'Isolated balance workspace',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: snapshot.account.id
				})
				.wait({ tier: 'local' })
			await db
				.insert(app.organizationMembers, {
					organizationId: workspace.id,
					userId: snapshot.account.id,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'local' })
			await db
				.insert(app.accounts, {
					organizationId: workspace.id,
					name: 'Other ledger',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'local' })
			return workspace.id
		})
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
