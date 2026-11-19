import { fixtureWindow as window } from '../state.js'

export const operation123 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const [organization] = await db.all(app.organizations)
	if (!organization) throw new Error('Missing organization')
	const organizationId = organization.id
	const account = await db
		.insert(app.accounts, { organizationId, name: 'Ledger', kind: 'bank', currency: 'USD' })
		.wait({ tier: 'local' })
	const category = await db
		.insert(app.categories, {
			organizationId,
			name: 'Expense category',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'local' })
	const expenseTag = await db
		.insert(app.tags, {
			organizationId,
			name: 'Expense only',
			kind: 'expense',
			categoryId: category.id
		})
		.wait({ tier: 'local' })
	await db
		.insert(app.tags, { organizationId, name: 'Income only', kind: 'income' })
		.wait({ tier: 'local' })
	const historical = await db
		.insert(app.tags, { organizationId, name: 'Archived history', kind: 'expense' })
		.wait({ tier: 'local' })
	const transaction = await db
		.insert(app.transactions, {
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 100,
			currency: 'USD',
			bookedOn: '2026-10-19',
			source: 'manual',
			memo: 'Original history'
		})
		.wait({ tier: 'local' })
	await db
		.insert(app.transactionTags, {
			organizationId,
			transactionId: transaction.id,
			tagId: historical.id
		})
		.wait({ tier: 'local' })
	await db.update(app.tags, historical.id, { archivedAt: new Date() }).wait({ tier: 'global' })
	return {
		organizationId,
		categoryId: category.id,
		expenseTagId: expenseTag.id,
		historicalId: historical.id,
		transactionId: transaction.id
	}
}

export const operation228 = async (seed: {
	organizationId: string
	categoryId: string
	expenseTagId: string
	historicalId: string
	transactionId: string
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	return {
		tags: await db.all(app.tags.where({ organizationId: seed.organizationId })),
		links: await db.all(app.transactionTags.where({ organizationId: seed.organizationId })),
		transactions: await db.all(app.transactions.where({ organizationId: seed.organizationId }))
	}
}

export const operation277 = async (entity: 'Category' | 'Tag') => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const session = getCurrentJazzSession()?.getSnapshot()
	const db = session?.client?.db
	const userId = session?.user?.accountId
	if (!db || !userId) throw new Error('Missing session')
	const [organization] = await db.all(app.organizations)
	if (!organization) throw new Error('Missing workspace')
	for (const name of ['Alpha active', 'Zulu history']) {
		const values = { organizationId: organization.id, name, kind: 'expense' } satisfies {
			organizationId: string
			name: string
			kind: 'expense'
		}
		if (entity === 'Category')
			await db.insert(app.categories, { ...values, isSystem: false }).wait({ tier: 'local' })
		else await db.insert(app.tags, values).wait({ tier: 'local' })
	}
	const second = await db
		.insert(app.organizations, {
			name: 'Empty filter workspace',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: userId
		})
		.wait({ tier: 'local' })
	await db
		.insert(app.organizationMembers, {
			organizationId: second.id,
			userId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'local' })
	return second.id
}
