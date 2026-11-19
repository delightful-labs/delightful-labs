import { fixtureWindow as window } from '../state.js'

export const operation8 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const [org] = await db.all(app.organizations)
	if (!org) throw new Error('Missing workspace')
	const account = await db
		.insert(app.accounts, {
			organizationId: org.id,
			name: 'Overview ledger',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'local' })
	const tzsAccount = await db
		.insert(app.accounts, {
			organizationId: org.id,
			name: 'TZS ledger',
			kind: 'cash',
			currency: 'TZS'
		})
		.wait({ tier: 'local' })

	const food = await db
		.insert(app.categories, {
			organizationId: org.id,
			name: 'Overview food',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'local' })
	const travel = await db
		.insert(app.categories, {
			organizationId: org.id,
			name: 'Overview travel',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'local' })
	function date(days: number) {
		const d = new Date()
		d.setDate(d.getDate() - days)
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
	}
	for (const row of [
		{
			description: 'Recent food',
			categoryId: food.id,
			amountMinor: 1000,
			bookedOn: date(0),
			currency: 'USD'
		},
		{
			description: 'Boundary food',
			categoryId: food.id,
			amountMinor: 2000,
			bookedOn: date(6),
			currency: 'USD'
		},
		{
			description: 'Older travel',
			categoryId: travel.id,
			amountMinor: 9000,
			bookedOn: date(29),
			currency: 'USD'
		},
		{
			description: 'Outside range',
			categoryId: food.id,
			amountMinor: 99999,
			bookedOn: date(30),
			currency: 'USD'
		},
		{
			description: 'TZS expense',
			categoryId: food.id,
			amountMinor: 500,
			bookedOn: date(0),
			currency: 'TZS'
		}
	])
		await db
			.insert(app.transactions, {
				...row,
				organizationId: org.id,
				accountId: row.currency === 'TZS' ? tzsAccount.id : account.id,
				kind: 'expense',
				source: 'manual'
			})
			.wait({ tier: 'local' })
}
