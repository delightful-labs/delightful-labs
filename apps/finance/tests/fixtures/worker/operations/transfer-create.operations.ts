import { fixtureWindow as window } from '../state.js'

export const operation21 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
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
}

export const operation66 = async (accountId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
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
}

export const operation219 = async ({
	accounts,
	count
}: {
	accounts: {
		organizationId: string
		checkingId: string
		cardId: string
		tanzanianAccountId: string
	}
	count: number
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const [account] = await db.all(app.accounts.where({ id: accounts.checkingId }))
	if (!account) throw new Error('Missing source account')
	const categories = await db.all(app.categories.where({ organizationId: account.organizationId }))
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
}
