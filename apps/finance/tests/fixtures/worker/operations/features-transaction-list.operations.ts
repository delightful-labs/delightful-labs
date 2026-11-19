import { fixtureWindow as window } from '../state.js'

export const operation40 = async (organizationId: string) => {
	const { app, db, userId } = window.workspaceSettingsTest
	const second = await db
		.insert(app.organizations, {
			name: 'Other transactions',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: userId
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.organizationMembers, {
			organizationId: second.id,
			userId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
	const checking = await db
		.insert(app.accounts, { organizationId, name: 'Checking', kind: 'bank', currency: 'USD' })
		.wait({ tier: 'global' })
	const cash = await db
		.insert(app.accounts, { organizationId, name: 'Cash', kind: 'cash', currency: 'USD' })
		.wait({ tier: 'global' })
	const business = await db
		.insert(app.accounts, {
			organizationId: second.id,
			name: 'Business',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const expense = await db
		.insert(app.categories, {
			organizationId,
			name: 'Test expenses',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'global' })
	const income = await db
		.insert(app.categories, {
			organizationId,
			name: 'Test income',
			kind: 'income',
			isSystem: false
		})
		.wait({ tier: 'global' })
	const businessExpense = await db
		.insert(app.categories, {
			organizationId: second.id,
			name: 'Business expenses',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'global' })
	const rows = [
		{
			organizationId,
			accountId: checking.id,
			categoryId: expense.id,
			kind: 'expense',
			bookedOn: '2026-10-01',
			description: 'Older expense'
		},
		{
			organizationId,
			accountId: cash.id,
			categoryId: expense.id,
			kind: 'expense',
			bookedOn: '2026-10-12',
			description: 'Recent expense'
		},
		{
			organizationId,
			accountId: checking.id,
			categoryId: income.id,
			kind: 'income',
			bookedOn: '2026-10-05',
			description: 'Salary'
		},
		{
			organizationId: second.id,
			accountId: business.id,
			categoryId: businessExpense.id,
			kind: 'expense',
			bookedOn: '2026-10-13',
			description: 'Business expense'
		}
	] satisfies Pick<
		import('#lib/queries.js').TransactionRow,
		'organizationId' | 'accountId' | 'categoryId' | 'kind' | 'bookedOn' | 'description'
	>[]
	for (const row of rows)
		await db
			.insert(app.transactions, {
				...row,
				amountMinor: 1234,
				currency: 'USD',
				source: 'manual',
				...(row.kind === 'income' ? { paymentMethod: 'cash' } : {})
			})
			.wait({ tier: 'global' })
	return { secondWorkspaceId: second.id, accountId: checking.id, categoryId: expense.id }
}

export const operation174 = async ({
	organizationId,
	accountId,
	categoryId
}: {
	secondWorkspaceId: string
	accountId: string
	categoryId: string
	organizationId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	await db
		.insert(app.transactions, {
			organizationId,
			accountId,
			categoryId,
			kind: 'expense',
			bookedOn: '2026-10-13',
			description: 'Live expense',
			amountMinor: 100,
			currency: 'USD',
			source: 'manual'
		})
		.wait({ tier: 'global' })
}

export const operation205 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Daily checking',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const tzs = await db
		.insert(app.accounts, {
			organizationId,
			name: 'TZS account',
			kind: 'bank',
			currency: 'TZS'
		})
		.wait({ tier: 'global' })
	const category = await db
		.insert(app.categories, {
			organizationId,
			name: 'Daily category',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'global' })
	const tag = await db
		.insert(app.tags, {
			organizationId,
			name: 'Historical tag',
			kind: category.kind,
			categoryId: category.id
		})
		.wait({ tier: 'global' })
	const first = await db
		.insert(app.transactions, {
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 1000,
			currency: 'USD',
			bookedOn: '2026-03-10',
			description: 'First daily entry',
			source: 'manual'
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.transactionTags, { organizationId, transactionId: first.id, tagId: tag.id })
		.wait({ tier: 'global' })
	await db
		.insert(app.transactions, {
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 250,
			currency: 'USD',
			bookedOn: '2026-03-10',
			source: 'manual'
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.transactions, {
			organizationId,
			accountId: tzs.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 300,
			currency: 'TZS',
			bookedOn: '2026-03-10',
			description: 'TZS daily entry',
			source: 'manual'
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.transactions, {
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 50,
			currency: 'USD',
			bookedOn: '2026-03-09',
			description: 'Previous day',
			source: 'manual'
		})
		.wait({ tier: 'global' })
	await db.update(app.tags, tag.id, { archivedAt: new Date() }).wait({ tier: 'global' })
	await db.update(app.categories, category.id, { archivedAt: new Date() }).wait({ tier: 'global' })
	return { accountId: account.id, categoryId: category.id, tagId: tag.id }
}

export const operation318 = async (fixture: {
	accountId: string
	categoryId: string
	tagId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	await db
		.update(app.accounts, fixture.accountId, {
			name: 'Renamed daily account',
			archivedAt: new Date()
		})
		.wait({ tier: 'global' })
	// System categories are protected; this is an ordinary category already archived.
	await db
		.update(app.categories, fixture.categoryId, { name: 'Renamed daily category' })
		.wait({ tier: 'global' })
	await db
		.update(app.tags, fixture.tagId, { name: 'Renamed historical tag' })
		.wait({ tier: 'global' })
}
