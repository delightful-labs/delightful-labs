import { fixtureWindow as window } from '../state.js'

export const operation14 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
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
}

export const operation90 = async (id: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	await db.update(app.transactions, id, { amountMinor: 20000 }).wait({ tier: 'local' })
}

export const operation107 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Missing session')
	const db = snapshot.client.db
	const workspace = await db
		.insert(app.organizations, {
			name: 'Isolated balance workspace',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: snapshot.user.accountId
		})
		.wait({ tier: 'local' })
	await db
		.insert(app.organizationMembers, {
			organizationId: workspace.id,
			userId: snapshot.user.accountId,
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
}
