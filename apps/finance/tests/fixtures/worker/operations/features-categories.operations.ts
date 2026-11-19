import { fixtureWindow as window } from '../state.js'

export const operation47 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	const org = await db
		.insert(app.organizations, {
			name: 'Category second workspace',
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
	return org.id
}

export const operation93 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	const category = await db
		.insert(app.categories, {
			organizationId,
			name: 'Counted category',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'global' })
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Count account',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const transaction = await db
		.insert(app.transactions, {
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 100,
			currency: 'USD',
			bookedOn: '2026-10-13',
			description: 'Category retained history',
			source: 'manual'
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.tags, {
			organizationId,
			name: 'Active connected tag',
			kind: category.kind,
			categoryId: category.id
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.tags, {
			organizationId,
			name: 'Archived connected tag',
			kind: category.kind,
			categoryId: category.id,
			archivedAt: new Date()
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.tags, { organizationId, name: 'Unconnected tag', kind: 'expense' })
		.wait({ tier: 'global' })
	const system = await db.one(
		app.categories.where({ organizationId, isSystem: true, kind: 'expense' })
	)
	if (!system) throw new Error('Missing system category')
	return { categoryId: category.id, transactionId: transaction.id, systemId: system.id }
}

export const operation164 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	try {
		await db.update(app.categories, id, { archivedAt: new Date() }).wait({ tier: 'global' })
		return 'accepted'
	} catch (error) {
		return error instanceof Error ? error.message : 'unknown-error'
	}
}

export const operation186 = async ({
	categoryId,
	transactionId
}: {
	categoryId: string
	transactionId: string
	systemId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	const category = await db.one(app.categories.where({ id: categoryId }), {
		tier: 'remote'
	})
	const transaction = await db.one(app.transactions.where({ id: transactionId }), {
		tier: 'remote'
	})
	const tags = await db.all(app.tags.where({ categoryId }), { tier: 'remote' })
	return {
		archived: Boolean(category?.archivedAt),
		retained: transaction?.categoryId === categoryId,
		tags: tags.length
	}
}

export const operation226 = () => window.workspaceSettingsTest.userId

export const operation227 = async ({
	organizationId,
	subjectId,
	role
}: {
	organizationId: string
	subjectId: string
	role: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	if (role !== 'admin' && role !== 'member' && role !== 'viewer') throw new Error('Invalid role')
	await db
		.insert(app.organizationMembers, {
			organizationId,
			userId: subjectId,
			role,
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
	return (
		await db
			.insert(app.categories, {
				organizationId,
				name: 'Permission category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
	).id
}

export const operation275 = async ({
	organizationId,
	categoryId
}: {
	organizationId: string
	categoryId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	const results: string[] = []
	try {
		await db
			.insert(app.categories, {
				organizationId,
				name: 'Forbidden category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
		results.push('accepted')
	} catch (error) {
		results.push(error instanceof Error ? error.message : 'unknown-error')
	}
	try {
		await db.update(app.categories, categoryId, { archivedAt: new Date() }).wait({ tier: 'global' })
		results.push('accepted')
	} catch (error) {
		results.push(error instanceof Error ? error.message : 'unknown-error')
	}
	return results
}

export const operation322 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	return Boolean((await db.one(app.categories.where({ id }), { tier: 'remote' }))?.archivedAt)
}

export const operation347 = () => window.workspaceSettingsTest.userId

export const operation348 = async ({
	organizationId,
	subjectId
}: {
	organizationId: string
	subjectId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	await db
		.insert(app.organizationMembers, {
			organizationId,
			userId: subjectId,
			role: 'viewer',
			accountAccessMode: 'selected'
		})
		.wait({ tier: 'global' })
	const category = await db
		.insert(app.categories, {
			organizationId,
			name: 'Scoped count',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'global' })
	for (const name of ['Readable count account', 'Private count account']) {
		const account = await db
			.insert(app.accounts, { organizationId, name, kind: 'cash', currency: 'USD' })
			.wait({ tier: 'global' })
		await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-13',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		if (name === 'Readable count account') {
			await db
				.insert(app.accountMemberships, {
					organizationId,
					userId: subjectId,
					accountId: account.id,
					access: 'read',
					canDelete: false
				})
				.wait({ tier: 'global' })
		}
	}
}
