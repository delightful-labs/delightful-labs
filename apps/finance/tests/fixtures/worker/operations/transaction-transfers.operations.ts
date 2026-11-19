import { fixtureWindow as window } from '../state.js'

export const operation5 = async (id: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	return (await db.all(app.transactions.where({ id }))).length > 0
}

export const operation18 = async (expenseTransactionId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	return (await db.all(app.internalTransfers.where({ expenseTransactionId }))).length > 0
}

export const operation31 = async ({
	expenseId,
	incomeId
}: {
	expenseId: string
	incomeId: string
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
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
}

export const operation154 = async (incomeId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	await db.update(app.transactions, incomeId, { internalTransferId: null }).wait({ tier: 'local' })
}
