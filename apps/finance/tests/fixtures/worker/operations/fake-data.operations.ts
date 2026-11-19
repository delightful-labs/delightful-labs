import { fixtureWindow as window } from '../state.js'

export const operation4 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('No initialized Jazz database')
	const [accounts, transactions] = await Promise.all([
		db.all(app.accounts.orderBy('id'), { tier: 'remote' }),
		db.all(app.transactions.orderBy('id'), { tier: 'remote' })
	])
	return {
		accountIds: accounts.map((row) => row.id),
		transactionIds: transactions.map((row) => row.id),
		kinds: accounts.map((row) => row.kind).sort()
	}
}
