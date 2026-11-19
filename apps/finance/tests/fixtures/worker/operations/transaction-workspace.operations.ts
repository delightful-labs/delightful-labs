import { fixtureWindow as window } from '../state.js'

export const operation14 = async ({
	count,
	kind,
	bookedOn
}: {
	count: number
	kind: 'expense' | 'income'
	bookedOn: string
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const [organization] = await db.all(app.organizations)
	if (!organization) throw new Error('Missing organization')
	const account = await db
		.insert(app.accounts, {
			organizationId: organization.id,
			name: 'Workspace ledger',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'local' })
	const category = (
		await db.all(app.categories.where({ organizationId: organization.id, kind }))
	)[0]
	if (!category) throw new Error('Missing transaction category')
	for (let index = 0; index < count; index++) {
		await db
			.insert(app.transactions, {
				organizationId: organization.id,
				accountId: account.id,
				categoryId: category.id,
				kind,
				amountMinor: 100,
				currency: 'USD',
				bookedOn,
				description: `Seed ${index}`,
				source: 'manual'
			})
			.wait({ tier: 'local' })
	}
	return organization.id
}

export const operation91 = async ({
	workspaceId,
	kind,
	bookedOn
}: {
	workspaceId: string
	kind: 'expense' | 'income'
	bookedOn: string
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const account = await db
		.insert(app.accounts, {
			organizationId: workspaceId,
			name: 'TZS ledger',
			kind: 'cash',
			currency: 'TZS'
		})
		.wait({ tier: 'local' })
	const category = await db
		.insert(app.categories, {
			organizationId: workspaceId,
			name: 'Travel filter',
			kind,
			isSystem: false
		})
		.wait({ tier: 'local' })
	const tag = await db
		.insert(app.tags, {
			organizationId: workspaceId,
			name: 'Business tag',
			kind,
			categoryId: category.id
		})
		.wait({ tier: 'local' })
	const row = await db
		.insert(app.transactions, {
			organizationId: workspaceId,
			accountId: account.id,
			categoryId: category.id,
			kind,
			amountMinor: 1234,
			currency: 'TZS',
			bookedOn,
			description: 'Conference ticket',
			memo: 'Client visit',
			source: 'manual'
		})
		.wait({ tier: 'local' })
	await db
		.insert(app.transactionTags, {
			organizationId: workspaceId,
			transactionId: row.id,
			tagId: tag.id
		})
		.wait({ tier: 'local' })
	return { categoryId: category.id }
}

export const operation287 = async (description: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	return (await db.all(app.transactions)).filter((row) => row.description === description).length
}

export const operation506 = async (kind: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	return (await db.all(app.transactions)).filter((row) => row.kind === kind).length
}

export const operation569 = async (workspaceId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const account = (await db.all(app.accounts.where({ organizationId: workspaceId })))[0]
	const category = (
		await db.all(app.categories.where({ organizationId: workspaceId, kind: 'expense' }))
	)[0]
	if (!account || !category) throw new Error('Missing ledger fixture')
	for (let index = 0; index < 26; index++) {
		await db
			.insert(app.transactions, {
				organizationId: workspaceId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-19',
				description: `Layout fixture ${index}`,
				source: 'manual'
			})
			.wait({ tier: 'local' })
	}
}
