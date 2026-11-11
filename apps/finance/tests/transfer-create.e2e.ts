import { expect, test, type Page } from '@playwright/test'
import {
	holdWorkspaceWrite,
	machineErrors,
	ownRecoveryPhrase,
	requestRecovery
} from './helpers/workspace-drain.js'
import {
	openCreationModal,
	closeCreationModal,
	navigateSidebar,
	selectWorkspace,
	openSidebarSection
} from './helpers/ui.js'

async function seedAccounts(page: Page) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled({ timeout: 30_000 })
	return page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client) throw new Error('Test session is not ready.')
		const db = snapshot.client.db
		const [organization] = await db.all(app.organizations)
		if (!organization) throw new Error('Missing organization.')
		const checking = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Transfer checking',
				kind: 'bank',
				currency: 'USD'
			})
			.wait({ tier: 'local' })
		const card = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Transfer card',
				kind: 'card',
				currency: 'USD'
			})
			.wait({ tier: 'local' })
		const tanzanianAccount = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Transfer TZS account',
				kind: 'cash',
				currency: 'TZS'
			})
			.wait({ tier: 'local' })
		return {
			organizationId: organization.id,
			checkingId: checking.id,
			cardId: card.id,
			tanzanianAccountId: tanzanianAccount.id
		}
	})
}

async function persistedTransfer(page: Page, accountId: string) {
	return page.evaluate(async (accountId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const rows = await db.all(app.transactions.where({ accountId }))
		const links = await db.all(app.internalTransfers)
		return {
			rows: rows.map(
				({ id, organizationId, kind, amountMinor, currency, bookedOn, internalTransferId }) => ({
					id,
					organizationId,
					kind,
					amountMinor,
					currency,
					bookedOn,
					internalTransferId
				})
			),
			links: links.map(
				({
					id,
					organizationId,
					expenseTransactionId,
					incomeTransactionId,
					expenseAccountId,
					incomeAccountId,
					expenseAmountMinor,
					expenseCurrency,
					incomeAmountMinor,
					incomeCurrency,
					amountMinor,
					currency
				}) => ({
					id,
					organizationId,
					expenseTransactionId,
					incomeTransactionId,
					expenseAccountId,
					incomeAccountId,
					expenseAmountMinor,
					expenseCurrency,
					incomeAmountMinor,
					incomeCurrency,
					amountMinor,
					currency
				})
			)
		}
	}, accountId)
}

test(
	'creates both sides of a transfer together while offline',
	{ tag: ['@transactions'] },
	async ({ page, context }) => {
		const accounts = await seedAccounts(page)
		await page.goto('/transfers/new')
		await expect(page.getByLabel('Source Account', { exact: true })).toBeVisible()
		await page.getByLabel('Source Account', { exact: true }).selectOption(accounts.checkingId)
		await page.getByLabel('Destination Account', { exact: true }).selectOption(accounts.cardId)
		await page.getByLabel('Amount', { exact: true }).fill('42.17')
		await page.getByLabel('Date', { exact: true }).fill('2026-10-25')
		await context.setOffline(true)
		await page.getByRole('button', { name: 'Save Transfer', exact: true }).click()
		await expect(page.locator('form').getByRole('status')).toHaveText('Transfer saved.')
		await expect
			.poll(() => persistedTransfer(page, accounts.checkingId))
			.toMatchObject({
				rows: [
					expect.objectContaining({
						kind: 'expense',
						amountMinor: 4217,
						currency: 'USD',
						bookedOn: '2026-10-25'
					})
				],
				links: [
					expect.objectContaining({
						expenseAccountId: accounts.checkingId,
						incomeAccountId: accounts.cardId,
						expenseAmountMinor: 4217,
						expenseCurrency: 'USD',
						incomeAmountMinor: 4217,
						incomeCurrency: 'USD'
					})
				]
			})
		const expense = await persistedTransfer(page, accounts.checkingId)
		const income = await persistedTransfer(page, accounts.cardId)
		const transfer = expense.links[0]
		if (!transfer) throw new Error('Missing paired transfer link')
		expect(expense.rows[0]?.internalTransferId).toBe(transfer.id)
		expect(income.rows).toEqual([
			expect.objectContaining({
				id: transfer.incomeTransactionId,
				kind: 'income',
				amountMinor: 4217,
				currency: 'USD',
				bookedOn: '2026-10-25',
				internalTransferId: transfer.id
			})
		])
		expect(transfer.expenseTransactionId).toBe(expense.rows[0]?.id)
	}
)

test(
	'creates cross-currency transfers with separately entered amounts and currency facts',
	{ tag: ['@transactions'] },
	async ({ page, context }) => {
		const accounts = await seedAccounts(page)
		await page.goto('/transfers/new')
		await page.getByLabel('Source Account', { exact: true }).selectOption(accounts.checkingId)
		await page
			.getByLabel('Destination Account', { exact: true })
			.selectOption(accounts.tanzanianAccountId)
		const expenseAmount = page.getByLabel('Source Amount', { exact: true })
		const incomeAmount = page.getByLabel('Destination Amount', { exact: true })
		await expect(expenseAmount).toBeVisible()
		await expect(incomeAmount).toBeVisible()
		await expenseAmount.fill('42.17')
		await incomeAmount.fill('65000.00')
		await page.getByLabel('Date', { exact: true }).fill('2026-10-25')
		await context.setOffline(true)
		await page.getByRole('button', { name: 'Save Transfer', exact: true }).click()
		await expect(page.locator('form').getByRole('status')).toHaveText('Transfer saved.')
		const expense = await persistedTransfer(page, accounts.checkingId)
		const income = await persistedTransfer(page, accounts.tanzanianAccountId)
		const transfer = expense.links[0]
		if (!transfer) throw new Error('Missing paired transfer link')
		expect(expense.rows).toEqual([
			expect.objectContaining({ kind: 'expense', amountMinor: 4217, currency: 'USD' })
		])
		expect(income.rows).toEqual([
			expect.objectContaining({ kind: 'income', amountMinor: 6500000, currency: 'TZS' })
		])
		expect(transfer).toMatchObject({
			expenseAccountId: accounts.checkingId,
			incomeAccountId: accounts.tanzanianAccountId,
			expenseAmountMinor: 4217,
			expenseCurrency: 'USD',
			incomeAmountMinor: 6500000,
			incomeCurrency: 'TZS'
		})
	}
)

async function seedTransferList(page: Page, count = 1) {
	const accounts = await seedAccounts(page)
	return page.evaluate(
		async ({ accounts, count }) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			const [account] = await db.all(app.accounts.where({ id: accounts.checkingId }))
			if (!account) throw new Error('Missing source account')
			const categories = await db.all(
				app.categories.where({ organizationId: account.organizationId })
			)
			const expenseCategory = categories.find((row) => row.kind === 'expense')
			const incomeCategory = categories.find((row) => row.kind === 'income')
			if (!expenseCategory || !incomeCategory) throw new Error('Missing categories')
			const pairs: { id: string; expenseId: string; incomeId: string }[] = []
			for (let index = 0; index < count; index++) {
				const id = crypto.randomUUID()
				const expenseId = crypto.randomUUID()
				const incomeId = crypto.randomUUID()
				const write = await db.transaction((tx) => {
					tx.insert(
						app.transactions,
						{
							organizationId: account.organizationId,
							accountId: accounts.checkingId,
							categoryId: expenseCategory.id,
							kind: 'expense',
							amountMinor: 4217,
							currency: 'USD',
							bookedOn: index === 0 ? '2026-10-25' : '2026-10-24',
							description: `Outgoing ${index}`,
							source: 'manual',
							internalTransferId: id
						},
						{ id: expenseId }
					)
					tx.insert(
						app.transactions,
						{
							organizationId: account.organizationId,
							accountId: accounts.tanzanianAccountId,
							categoryId: incomeCategory.id,
							kind: 'income',
							amountMinor: 6500000,
							currency: 'TZS',
							bookedOn: '2026-10-26',
							description: `Incoming ${index}`,
							source: 'manual',
							internalTransferId: id
						},
						{ id: incomeId }
					)
					tx.insert(
						app.internalTransfers,
						{
							organizationId: account.organizationId,
							expenseTransactionId: expenseId,
							incomeTransactionId: incomeId,
							expenseAccountId: accounts.checkingId,
							incomeAccountId: accounts.tanzanianAccountId,
							expenseAmountMinor: 4217,
							expenseCurrency: 'USD',
							incomeAmountMinor: 6500000,
							incomeCurrency: 'TZS'
						},
						{ id }
					)
				})
				await write.wait({ tier: 'local' })
				pairs.push({ id, expenseId, incomeId })
			}
			return { accounts, pairs }
		},
		{ accounts, count }
	)
}

for (const desktop of [true, false]) {
	test(
		`${desktop ? 'desktop' : 'mobile'} transfer sidebar opens disabled saved fields and both transaction links`,
		{ tag: ['@transactions'] },
		async ({ page }) => {
			await page.setViewportSize({ width: desktop ? 1440 : 390, height: 900 })
			const fixture = await seedTransferList(page)
			const pair = fixture.pairs[0]
			if (!pair) throw new Error('Missing transfer')
			await page.goto('/transfers')
			const content = page.locator('.app-shell > .workspace > .content')
			const drawer = content.locator('aside[data-side="right"]')
			if (desktop) await expect(drawer).toHaveAttribute('data-open', 'true')
			else await expect(drawer).toHaveCount(0)
			await expect(content.locator('.entries > li')).toHaveCount(1)
			await expect(content.locator('.entries > li')).toContainText(
				'Transfer checking → Transfer TZS account'
			)
			await expect(content.locator('.entries > li')).toContainText('$42.17')
			await expect(content.locator('.entries > li')).toContainText('65,000.00')
			await expect(content.locator('[aria-label^="Daily total:"]')).toHaveCount(0)
			const transferLink = content.getByRole('link', {
				name: /^Transfer details: Transfer checking → Transfer TZS account/
			})
			await transferLink
				.getByText('Transfer checking → Transfer TZS account', { exact: true })
				.click()
			await expect(page).toHaveURL((url) => url.pathname === `/transfers/${pair.id}`)
			const source = content.getByLabel('Source Account', { exact: true })
			await expect(source).toHaveValue(fixture.accounts.checkingId)
			await expect(source).toBeDisabled()
			await expect(content.getByLabel('Destination Account', { exact: true })).toHaveValue(
				fixture.accounts.tanzanianAccountId
			)
			await expect(content.getByLabel('Source Amount', { exact: true })).toHaveValue('42.17')
			await expect(content.getByLabel('Destination Amount', { exact: true })).toHaveValue(
				'65000.00'
			)
			await expect(content.getByLabel('Source Date', { exact: true })).toHaveValue('2026-10-25')
			await expect(content.getByLabel('Destination Date', { exact: true })).toHaveValue(
				'2026-10-26'
			)
			for (const field of await content.locator('form input, form select').all())
				await expect(field).toBeDisabled()
			await expect(content.getByLabel('Description', { exact: true }).nth(0)).toHaveValue(
				'Outgoing 0'
			)
			await expect(content.getByLabel('Description', { exact: true }).nth(1)).toHaveValue(
				'Incoming 0'
			)
			const expenseLink = content.getByRole('link', { name: 'Expense details', exact: true })
			const incomeLink = content.getByRole('link', { name: 'Income details', exact: true })
			await expect(expenseLink).toHaveAttribute(
				'href',
				new RegExp(`/expenses/${pair.expenseId}\\?workspace=`)
			)
			await expect(incomeLink).toHaveAttribute(
				'href',
				new RegExp(`/income/${pair.incomeId}\\?workspace=`)
			)
			if (desktop) await expect(drawer.locator('.entries > li')).toHaveCount(1)
			else {
				await expect(content.locator('.entries')).toHaveCount(0)
				await content.getByRole('link', { name: 'Back to List', exact: true }).click()
				await expect(page).toHaveURL((url) => url.pathname === '/transfers')
				await content.locator('.entries a').click()
			}
			await incomeLink.click()
			await expect(page).toHaveURL((url) => url.pathname === `/income/${pair.incomeId}`)
			await expect(content.getByLabel('Amount', { exact: true })).toHaveValue('65000.00')
			await page.goBack()
			await expenseLink.click()
			await expect(page).toHaveURL((url) => url.pathname === `/expenses/${pair.expenseId}`)
			await expect(content.getByLabel('Amount', { exact: true })).toHaveValue('42.17')
			await page.goto('/transfers')
			await content.getByRole('link', { name: 'Add Transfer', exact: true }).click()
			await expect(content.getByLabel('Source Account', { exact: true })).toBeEnabled()
			if (desktop) await expect(drawer.locator('.entries > li')).toHaveCount(1)
			else await expect(content.locator('.entries')).toHaveCount(0)
			if (desktop) {
				await page.goto(`/expenses/${pair.expenseId}`)
				const suggestions = page.getByRole('region', { name: 'Matching transactions' })
				await suggestions.getByRole('button', { name: 'Unlink Transfer', exact: true }).click()
				await expect(suggestions.getByText('Transfer saved.', { exact: true })).toBeVisible()
				await page.goto(`/transfers/${pair.id}`)
				await expect(content.getByText('Transfer unavailable', { exact: true })).toBeVisible()
				await expect(content.locator('form')).toHaveCount(0)
				await expect(content.locator('.entries > li')).toHaveCount(0)
			}
		}
	)
}

test(
	'transfer pagination and either-account filters retain the selected detail',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await seedTransferList(page, 26)
		await page.goto('/transfers')
		const content = page.locator('.app-shell > .workspace > .content')
		await expect(content.locator('.entries > li')).toHaveCount(25)
		await expect(content.locator('.entries > li').first()).toContainText('Outgoing 0')
		await content.getByRole('link', { name: 'Page 2', exact: true }).click()
		await expect(content.locator('.entries > li')).toHaveCount(1)
		await content.locator('.entries a').click()
		await expect(page).toHaveURL(
			(url) => /^\/transfers\/[^/]+$/.test(url.pathname) && url.searchParams.get('page') === '2'
		)
		await expect(content.getByLabel('Source Amount', { exact: true })).toHaveValue('42.17')
		const addHref = await content
			.getByRole('link', { name: 'Add Transfer', exact: true })
			.getAttribute('href')
		if (!addHref) throw new Error('Missing scoped Add Transfer destination')
		const destination = new URL(addHref, page.url())
		expect(destination.pathname).toBe('/transfers/new')
		expect(destination.searchParams.get('page')).toBe('2')
		expect(destination.searchParams.get('workspace')).toBe(
			new URL(page.url()).searchParams.get('workspace')
		)
		await openSidebarSection(page, 'Accounts')
		await page.getByRole('checkbox', { name: 'Transfer checking', exact: true }).uncheck()
		await expect(page).toHaveURL((url) => url.searchParams.get('page') === null)
		await expect(content.locator('.entries > li')).toHaveCount(25)
		await page.getByRole('checkbox', { name: 'Transfer TZS account', exact: true }).uncheck()
		await expect(content.locator('.entries > li')).toHaveCount(0)
		await expect(content.getByLabel('Source Amount', { exact: true })).toHaveValue('42.17')
		await page.getByRole('checkbox', { name: 'Transfer checking', exact: true }).check()
		await expect(content.locator('.entries > li')).toHaveCount(25)
	}
)

for (const interruption of ['switch', 'recover'] satisfies ('switch' | 'recover')[]) {
	test(
		`retains an issued transfer write through workspace ${interruption}`,
		{ tag: ['@transactions'] },
		async ({ page }) => {
			const errors = machineErrors(page)
			const accounts = await seedAccounts(page)
			let destination = ''
			let phrase = ''
			if (interruption === 'switch') {
				await navigateSidebar(page, 'Workspaces')
				const dialog = await openCreationModal(page, 'Create Workspace')
				await dialog
					.getByLabel('Workspace name', { exact: true })
					.fill('Transfer drain destination')
				await dialog.getByRole('button', { name: 'Create Workspace', exact: true }).click()
				await expect(dialog.getByRole('status')).toHaveText('Workspace saved.')
				const href = await page
					.getByRole('link', { name: 'Open Workspace: Transfer drain destination', exact: true })
					.getAttribute('href')
				if (!href) throw new Error('Missing destination')
				destination = new URL(href, page.url()).searchParams.get('workspace') ?? ''
				await closeCreationModal(page)
			} else phrase = await ownRecoveryPhrase(page)
			if (interruption === 'recover') {
				await navigateSidebar(page, 'Transfers')
				await page.getByRole('link', { name: 'Add Transfer', exact: true }).click()
			} else await page.goto(`/transfers/new?workspace=${accounts.organizationId}`)
			await page.getByLabel('Source Account', { exact: true }).selectOption(accounts.checkingId)
			await page.getByLabel('Destination Account', { exact: true }).selectOption(accounts.cardId)
			await page.getByLabel('Amount', { exact: true }).fill('42.17')
			await page.getByLabel('Date', { exact: true }).fill('2026-10-25')
			const gate = await holdWorkspaceWrite(page, 'transfer')
			try {
				await page.getByRole('button', { name: 'Save Transfer', exact: true }).click()
				await expect.poll(() => gate.evaluate((value) => value.started)).toBe(true)
				if (interruption === 'switch') {
					await selectWorkspace(page.getByLabel('Current Workspace', { exact: true }), destination)
					await expect(page).toHaveURL(`/transfers/new?workspace=${destination}`)
					await expect(
						page.getByRole('button', { name: 'Save Transfer', exact: true })
					).toHaveCount(0)
				} else {
					await requestRecovery(page, phrase)
					expect(await gate.evaluate((value) => value.restores)).toBe(0)
				}
				await gate.evaluate((value) => value.release())
				if (interruption === 'switch') {
					await expect(page.getByLabel('Source Account', { exact: true })).toBeVisible()
					await expect(
						page
							.getByLabel('Source Account', { exact: true })
							.locator(`option[value="${accounts.checkingId}"]`)
					).toHaveCount(0)
				} else {
					await expect.poll(() => gate.evaluate((value) => value.restores)).toBe(1)
					expect(errors).toEqual([])
					await expect
						.poll(() => gate.evaluate((value) => value.snapshot()))
						.toMatchObject({ status: 'ready', pending: null, hasClient: true, errorName: null })
					await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(
						accounts.organizationId
					)
				}
				const saved = await persistedTransfer(page, accounts.checkingId)
				expect(saved.rows).toHaveLength(1)
				expect(saved.links).toHaveLength(1)
				expect(saved.links[0]?.organizationId).toBe(accounts.organizationId)
				expect((await persistedTransfer(page, accounts.cardId)).rows).toHaveLength(1)
				expect(errors).toEqual([])
			} finally {
				await gate.evaluate((value) => value.restore())
				await gate.dispose()
			}
		}
	)
}
