import { fixtureWindow as window } from '../state.js'

export const operation14 = async ({
	organizationId,
	kind
}: {
	organizationId: string
	kind: string
}) => {
	const { app, db, userId } = window.workspaceSettingsTest
	if (kind !== 'expense' && kind !== 'income') throw new Error('Invalid kind')
	const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
	if (!profile) throw new Error('Missing profile')
	await db
		.update(app.profiles, profile.id, { displayName: 'Detail author' })
		.wait({ tier: 'global' })
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Detail account',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const category = await db
		.insert(app.categories, {
			organizationId,
			name: 'Detail category',
			kind,
			isSystem: false
		})
		.wait({ tier: 'global' })
	const tag = await db
		.insert(app.tags, {
			organizationId,
			name: 'Detail tag',
			kind: category.kind,
			categoryId: category.id
		})
		.wait({ tier: 'global' })
	const id = crypto.randomUUID()
	const checkId = crypto.randomUUID()
	const write = await db.transaction((tx) => {
		if (kind === 'income')
			tx.insert(
				app.checks,
				{
					organizationId,
					accountId: account.id,
					checkNumber: '12345',
					checkDate: '2026-10-13'
				},
				{ id: checkId }
			)
		const transaction = tx.insert(
			app.transactions,
			{
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind,
				amountMinor: 1234,
				currency: 'USD',
				bookedOn: '2026-10-14',
				description: 'Detail description',
				memo: 'Original detail memo',
				source: 'manual',
				...(kind === 'income' ? { paymentMethod: 'check', checkId } : {})
			},
			{ id }
		)
		tx.insert(app.transactionTags, { organizationId, transactionId: id, tagId: tag.id })

		return transaction
	})
	const transaction = await write.wait({ tier: 'global' })
	const metadata = await db.one(
		app.transactions.where({ id: transaction.id }).select('$createdAt', '$createdBy'),
		{ tier: 'remote' }
	)
	if (!metadata) throw new Error('Missing metadata')
	return {
		id: transaction.id,
		createdAt: metadata.$createdAt.toISOString(),
		author: metadata.$createdBy.account
	}
}

export const operation132 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	await db.update(app.transactions, id, { memo: 'Updated detail memo' }).wait({ tier: 'global' })
}

export const operation157 = async (organizationId: string) => {
	const { app, db, userId } = window.workspaceSettingsTest
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Scope account',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const category = await db.one(
		app.categories.where({ organizationId, kind: 'expense', isSystem: true })
	)
	if (!category) throw new Error('Missing category')
	const transaction = await db
		.insert(app.transactions, {
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 100,
			currency: 'USD',
			bookedOn: '2026-10-14',
			memo: 'Scoped detail',
			source: 'manual'
		})
		.wait({ tier: 'global' })
	const org = await db
		.insert(app.organizations, {
			name: 'Other detail workspace',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: userId
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.organizationMembers, {
			organizationId: org.id,
			userId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
	return { id: transaction.id, otherId: org.id }
}

export const operation257 = () => window.workspaceSettingsTest.userId

export const operation258 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
	if (!profile) throw new Error('Missing author profile')
	await db
		.update(app.profiles, profile.id, { displayName: 'Shared author' })
		.wait({ tier: 'global' })
}

export const operation270 = () => window.workspaceSettingsTest.userId

export const operation271 = async ({
	organizationId,
	subjectId,
	scenario
}: {
	organizationId: string
	subjectId: string
	scenario: {
		name: string
		role: string
		mode: string
		grant: boolean
		read: boolean
		edit: boolean
	}
}) => {
	const { app, db } = window.workspaceSettingsTest
	if (scenario.role !== 'viewer' && scenario.role !== 'member') throw new Error('Invalid role')
	if (scenario.mode !== 'all' && scenario.mode !== 'selected') throw new Error('Invalid mode')
	await db
		.insert(app.organizationMembers, {
			organizationId,
			userId: subjectId,
			role: scenario.role,
			accountAccessMode: scenario.mode
		})
		.wait({ tier: 'global' })
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Shared detail account',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	if (scenario.grant)
		await db
			.insert(app.accountMemberships, {
				organizationId,
				userId: subjectId,
				accountId: account.id,
				access: 'read',
				canDelete: false
			})
			.wait({ tier: 'global' })
	const category = await db.one(
		app.categories.where({ organizationId, kind: 'expense', isSystem: true })
	)
	if (!category) throw new Error('No Category')
	const tag = await db
		.insert(app.tags, { organizationId, name: 'Shared detail tag', kind: 'expense' })
		.wait({ tier: 'global' })
	const transaction = await db
		.insert(app.transactions, {
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 100,
			currency: 'USD',
			bookedOn: '2026-10-14',
			memo: 'Shared detail memo',
			source: 'manual'
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.transactionTags, {
			organizationId,
			transactionId: transaction.id,
			tagId: tag.id
		})
		.wait({ tier: 'global' })
	const metadata = await db.one(
		app.transactions.where({ id: transaction.id }).select('$createdAt'),
		{ tier: 'remote' }
	)
	return { id: transaction.id, createdAt: metadata?.$createdAt.toISOString() }
}

export const operation345 = async (id: string) => {
	const { app, db, userId } = window.workspaceSettingsTest
	const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
	if (!profile) throw new Error('No editor profile')
	await db
		.update(app.profiles, profile.id, { displayName: 'Detail editor' })
		.wait({ tier: 'global' })
	await db.one(app.transactions.where({ id }), { tier: 'remote' })
	await db.update(app.transactions, id, { memo: 'Edited by member' }).wait({ tier: 'global' })
}
