import { expect, test, type Page } from '@playwright/test'
import { seedTransaction, persisted } from './helpers/transactions.js'

async function transactionExists(page: Page, id: string) {
	return page.evaluate(async (id) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return (await db.all(app.transactions.where({ id }))).length > 0
	}, id)
}

async function transferExists(page: Page, expenseTransactionId: string) {
	return page.evaluate(async (expenseTransactionId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return (await db.all(app.internalTransfers.where({ expenseTransactionId }))).length > 0
	}, expenseTransactionId)
}

async function seedLinkedTransfer(page: Page, expenseId: string, incomeId: string) {
	await page.evaluate(
		async ({ expenseId, incomeId }) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			const [expense] = await db.all(app.transactions.where({ id: expenseId }))
			const [income] = await db.all(app.transactions.where({ id: incomeId }))
			if (!expense || !income) throw new Error('Missing transfer transactions')
			const transferId = crypto.randomUUID()
			const write = await db.transaction((tx) => {
				tx.update(app.transactions, expenseId, { internalTransferId: transferId })
				tx.update(app.transactions, incomeId, { internalTransferId: transferId })
				tx.insert(
					app.internalTransfers,
					{
						organizationId: expense.organizationId,
						expenseTransactionId: expense.id,
						incomeTransactionId: income.id,
						expenseAccountId: expense.accountId,
						incomeAccountId: income.accountId,
						expenseAmountMinor: expense.amountMinor,
						expenseCurrency: expense.currency,
						incomeAmountMinor: income.amountMinor,
						incomeCurrency: income.currency
					},
					{ id: transferId }
				)
			})
			// Establish an accepted link before navigating or deliberately corrupting its markers.
			await write.wait({ tier: 'global' })
		},
		{ expenseId, incomeId }
	)
	await page.goto(`/income/${incomeId}`)
	await expect(page.getByText('Linked to Transfer')).toBeVisible()
}

test(
	'links and unlinks a matching synced transaction without changing either transaction',
	{ tag: ['@transactions', '@transaction-edit'] },
	async ({ page }) => {
		const seed = await seedTransaction(page, 'transfer')
		if (!seed.counterpartId) throw new Error('Missing transfer counterpart fixture')
		await page.goto(`/expenses/${seed.id}`)
		const convertToTransfer = page.getByRole('checkbox', {
			name: 'Convert this transaction to a transfer',
			exact: true
		})
		await expect(convertToTransfer).not.toBeChecked()
		await expect(page.getByRole('region', { name: 'Matching transactions' })).toHaveCount(0)
		await convertToTransfer.check()
		const suggestions = page.getByRole('region', { name: 'Matching transactions' })
		const counterpart = suggestions.getByRole('radio', {
			name: 'Oct 25, 2026 · Destination ledger $1.00',
			exact: true
		})
		await expect(counterpart).toBeVisible()
		await expect(suggestions.getByRole('radio')).toHaveCount(1)
		await counterpart.check()
		await suggestions
			.getByRole('button', { name: 'Link to existing Transaction', exact: true })
			.click()
		await expect(suggestions.getByText('Linked to Transfer')).toBeVisible()
		await expect(suggestions.getByText('Transfer saved.', { exact: true })).toBeVisible()
		await expect
			.poll(() => persisted(page, seed.id))
			.toMatchObject({
				source: 'simplefin',
				externalId: 'imported-edit-test',
				transfers: [{ expenseTransactionId: seed.id, incomeTransactionId: seed.counterpartId }]
			})
		const counterpartId = seed.counterpartId
		if (!counterpartId) throw new Error('Missing transfer counterpart fixture')
		await expect
			.poll(() => persisted(page, counterpartId))
			.toMatchObject({
				source: 'simplefin',
				externalId: 'imported-transfer-counterpart',
				transfers: []
			})
		const openCounterpart = suggestions.getByRole('link', { name: 'Open Transaction', exact: true })
		await expect(openCounterpart).toHaveAttribute(
			'href',
			new RegExp(`/income/${counterpartId}\\?workspace=`)
		)
		await openCounterpart.click()
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === `/income/${counterpartId}` && Boolean(url.searchParams.get('workspace'))
		)
		await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
		const linkedCounterpart = page.getByRole('region', { name: 'Matching transactions' })
		await expect(
			linkedCounterpart.getByRole('link', { name: 'Open Transaction', exact: true })
		).toHaveAttribute('href', new RegExp(`/expenses/${seed.id}\\?workspace=`))
		await linkedCounterpart.getByRole('button', { name: 'Unlink Transfer', exact: true }).click()
		await expect(linkedCounterpart.getByText('Transfer saved.')).toBeVisible()
		await expect
			.poll(() => persisted(page, seed.id))
			.toMatchObject({ internalTransferId: null, transfers: [] })
		await expect
			.poll(() => persisted(page, counterpartId))
			.toMatchObject({ internalTransferId: null, transfers: [] })
	}
)

test(
	'shows an inconsistent transfer and prevents further link actions',
	{ tag: ['@transactions', '@transaction-edit'] },
	async ({ page }) => {
		const seed = await seedTransaction(page, 'transfer')
		if (!seed.counterpartId) throw new Error('Missing transfer counterpart fixture')
		await seedLinkedTransfer(page, seed.id, seed.counterpartId)
		const suggestions = page.getByRole('region', { name: 'Matching transactions' })
		await suggestions.getByRole('link', { name: 'Open Transaction', exact: true }).click()
		await expect(page).toHaveURL(
			(url) => url.pathname === `/expenses/${seed.id}` && Boolean(url.searchParams.get('workspace'))
		)
		await expect(suggestions.getByText('Linked to Transfer')).toBeVisible()
		await page.evaluate(async (incomeId) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			await db
				.update(app.transactions, incomeId, { internalTransferId: null })
				.wait({ tier: 'local' })
		}, seed.counterpartId)
		await expect(suggestions.getByText(/This transfer link is inconsistent\./)).toBeVisible()
		await expect(
			page.getByRole('checkbox', { name: 'Convert this transaction to a transfer' })
		).toHaveCount(0)
		await expect(suggestions.getByRole('button', { name: 'Unlink Transfer' })).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Delete Transactions' })).toHaveCount(0)
	}
)

test(
	'deletes both transactions from the linked-transaction choices',
	{ tag: ['@transactions', '@transaction-edit'] },
	async ({ page }) => {
		const seed = await seedTransaction(page, 'transfer')
		if (!seed.counterpartId) throw new Error('Missing transfer counterpart fixture')
		await seedLinkedTransfer(page, seed.id, seed.counterpartId)
		await page.getByRole('button', { name: 'Delete Transactions', exact: true }).click()
		const dialog = page.getByRole('dialog', { name: 'Delete Transactions' })
		await expect(
			dialog.getByText('Both transactions and their transfer link will be deleted.')
		).toBeVisible()
		await expect(
			dialog.getByText(/other transaction will remain as ordinary income or expense/)
		).toBeVisible()
		await dialog.getByRole('button', { name: 'Delete Transactions', exact: true }).click()
		await expect(
			page.getByText('Both linked transactions were deleted on this device.')
		).toBeVisible()
		await expect.poll(() => transactionExists(page, seed.id)).toBe(false)
		await expect.poll(() => transactionExists(page, seed.counterpartId!)).toBe(false)
		await expect.poll(() => transferExists(page, seed.id)).toBe(false)
	}
)

test(
	'unlinks and deletes only the current transaction, restoring the counterpart to totals',
	{ tag: ['@transactions', '@transaction-edit'] },
	async ({ page }) => {
		const seed = await seedTransaction(page, 'transfer')
		if (!seed.counterpartId) throw new Error('Missing transfer counterpart fixture')
		await seedLinkedTransfer(page, seed.id, seed.counterpartId)
		await page.getByRole('button', { name: 'Delete Transactions', exact: true }).click()
		const dialog = page.getByRole('dialog', { name: 'Delete Transactions' })
		await dialog.getByRole('button', { name: 'Delete Transaction', exact: true }).click()
		await expect(
			page.getByText(
				'This transaction was unlinked and deleted on this device. The other transaction remains.'
			)
		).toBeVisible()
		await expect.poll(() => transactionExists(page, seed.counterpartId!)).toBe(false)
		await expect.poll(() => transactionExists(page, seed.id)).toBe(true)
		await expect.poll(() => transferExists(page, seed.id)).toBe(false)
		await expect
			.poll(() => persisted(page, seed.id))
			.toMatchObject({ internalTransferId: null, amountMinor: 100, source: 'simplefin' })
		await page.goto('/')
		await expect(page.getByText('Total Expenses: $1.00', { exact: true })).toBeVisible()
	}
)

test(
	'suggests an exact amount match and filters out other amounts',
	{ tag: ['@transactions', '@transaction-edit'] },
	async ({ page }) => {
		const seed = await seedTransaction(page, 'transfer')
		await page.goto(`/expenses/${seed.id}`)
		const convertToTransfer = page.getByRole('checkbox', {
			name: 'Convert this transaction to a transfer',
			exact: true
		})
		await expect(page.getByRole('region', { name: 'Matching transactions' })).toHaveCount(0)
		await convertToTransfer.check()
		const suggestions = page.getByRole('region', { name: 'Matching transactions' })
		await expect(
			suggestions.getByRole('radio', {
				name: 'Oct 25, 2026 · Destination ledger $1.00',
				exact: true
			})
		).toBeVisible()
		await expect(suggestions.getByRole('radio')).toHaveCount(1)
	}
)
