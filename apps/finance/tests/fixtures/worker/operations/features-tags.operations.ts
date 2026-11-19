import { fixtureWindow as window } from '../state.js'

export const operation17 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	await db
		.insert(app.categories, {
			organizationId,
			name: 'Archived choice',
			kind: 'expense',
			isSystem: false,
			archivedAt: new Date()
		})
		.wait({ tier: 'global' })
	return (
		await db
			.insert(app.categories, {
				organizationId,
				name: 'Tag category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
	).id
}

export const operation75 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	await db.update(app.categories, id, { archivedAt: new Date() }).wait({ tier: 'global' })
}

export const operation110 = async (organizationId: string) => {
	const { app, db, userId } = window.workspaceSettingsTest
	const category = await db
		.insert(app.categories, {
			organizationId,
			name: 'Retained tag category',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'global' })
	const tag = await db
		.insert(app.tags, {
			organizationId,
			name: 'Archive tag',
			kind: category.kind,
			categoryId: category.id
		})
		.wait({ tier: 'global' })
	const org = await db
		.insert(app.organizations, {
			name: 'Second tag workspace',
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
	await db
		.insert(app.categories, {
			organizationId: org.id,
			name: 'Second category',
			kind: 'income',
			isSystem: false
		})
		.wait({ tier: 'global' })
	return { secondId: org.id, tagId: tag.id, categoryId: category.id }
}

export const operation189 = async ({
	tagId,
	categoryId
}: {
	secondId: string
	tagId: string
	categoryId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	const tag = await db.one(app.tags.where({ id: tagId }), { tier: 'remote' })
	return {
		archived: Boolean(tag?.archivedAt),
		categoryRetained: tag?.categoryId === categoryId
	}
}

export const operation220 = () => window.workspaceSettingsTest.userId

export const operation221 = async ({
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
			.insert(app.tags, {
				organizationId,
				name: 'Permission tag',
				kind: 'expense'
			})
			.wait({ tier: 'global' })
	).id
}

export const operation266 = async ({
	organizationId,
	tagId
}: {
	organizationId: string
	tagId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	const results: string[] = []
	try {
		await db
			.insert(app.tags, {
				organizationId,
				name: 'Forbidden tag',
				kind: 'expense'
			})
			.wait({ tier: 'global' })
		results.push('accepted')
	} catch (error) {
		results.push(error instanceof Error ? error.message : 'unknown-error')
	}
	try {
		await db.update(app.tags, tagId, { archivedAt: new Date() }).wait({ tier: 'global' })
		results.push('accepted')
	} catch (error) {
		results.push(error instanceof Error ? error.message : 'unknown-error')
	}
	return results
}

export const operation310 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	return Boolean((await db.one(app.tags.where({ id }), { tier: 'remote' }))?.archivedAt)
}

export const operation332 = async ({
	organizationId,
	kind
}: {
	organizationId: string
	kind: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	if (kind !== 'expense' && kind !== 'income') throw new Error('Invalid kind')
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Tag entry account',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const category = await db
		.insert(app.categories, {
			organizationId,
			name: 'Selected tag category',
			kind,
			isSystem: false
		})
		.wait({ tier: 'global' })
	const previous = await db
		.insert(app.categories, {
			organizationId,
			name: 'Existing tag category',
			kind,
			isSystem: false
		})
		.wait({ tier: 'global' })
	const tag = await db
		.insert(app.tags, {
			organizationId,
			name: 'Existing tag',
			kind,
			categoryId: previous.id
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.tags, {
			organizationId,
			name: 'Archived entry tag',
			kind,
			archivedAt: new Date()
		})
		.wait({ tier: 'global' })
	return {
		accountId: account.id,
		categoryId: category.id,
		previousId: previous.id,
		tagId: tag.id
	}
}

export const operation425 = async ({
	organizationId,
	fixture
}: {
	organizationId: string
	fixture: { accountId: string; categoryId: string; previousId: string; tagId: string }
}) => {
	const { app, db } = window.workspaceSettingsTest
	const transactions = await db.all(
		app.transactions.where({ organizationId, memo: 'Tagged entry' }),
		{ tier: 'remote' }
	)
	const transaction = transactions[0]
	if (!transaction) return null
	const links = await db.all(app.transactionTags.where({ transactionId: transaction.id }), {
		tier: 'remote'
	})
	const tags = await db.all(app.tags.where({ organizationId }), { tier: 'remote' })
	return {
		transactions: transactions.length,
		links: links.length,
		existingCategory: tags.find((tag) => tag.id === fixture.tagId)?.categoryId,
		newCategory: tags.find((tag) => tag.name === 'New tag')?.categoryId,
		removed: tags.some((tag) => tag.name === 'Removed tag'),
		linkedNames: links.map((link) => tags.find((tag) => tag.id === link.tagId)?.name).sort()
	}
}

export const operation478 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	const transaction = await db.one(
		app.transactions.where({ organizationId, memo: 'No tags entry' }),
		{ tier: 'remote' }
	)
	if (!transaction) return -1
	return (
		await db.all(app.transactionTags.where({ transactionId: transaction.id }), {
			tier: 'remote'
		})
	).length
}

export const operation503 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	await db
		.insert(app.accounts, {
			organizationId,
			name: 'Retry tag account',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	return (
		await db
			.insert(app.tags, {
				organizationId,
				name: 'Archive while selected',
				kind: 'expense'
			})
			.wait({ tier: 'global' })
	).id
}

export const operation539 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	await db.update(app.tags, id, { archivedAt: new Date() }).wait({ tier: 'global' })
}

export const operation547 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	return (
		await db.all(app.transactions.where({ organizationId, memo: 'Retry tagged entry' }), {
			tier: 'remote'
		})
	).length
}

export const operation564 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	const transaction = await db.one(
		app.transactions.where({ organizationId, memo: 'Retry tagged entry' }),
		{ tier: 'remote' }
	)
	if (!transaction) return []
	const links = await db.all(app.transactionTags.where({ transactionId: transaction.id }), {
		tier: 'remote'
	})
	const tags = await db.all(app.tags.where({ organizationId }), { tier: 'remote' })
	return links.map((link) => tags.find((tag) => tag.id === link.tagId)?.name).sort()
}

export const operation588 = async (organizationId: string) => {
	const { app, db, userId } = window.workspaceSettingsTest
	await db
		.insert(app.accounts, {
			organizationId,
			name: 'First tag account',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.tags, { organizationId, name: 'First workspace tag', kind: 'expense' })
		.wait({ tier: 'global' })
	const org = await db
		.insert(app.organizations, {
			name: 'Offline tag workspace',
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
	const account = await db
		.insert(app.accounts, {
			organizationId: org.id,
			name: 'Offline tag account',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const category = await db
		.insert(app.categories, {
			organizationId: org.id,
			name: 'Offline tag category',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'global' })
	return { organizationId: org.id, accountId: account.id, categoryId: category.id }
}

export const operation669 = async (fixture: {
	organizationId: string
	accountId: string
	categoryId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	const transaction = await db.one(
		app.transactions.where({
			organizationId: fixture.organizationId,
			memo: 'Offline tag entry'
		}),
		{ tier: 'remote' }
	)
	const tag = await db.one(
		app.tags.where({ organizationId: fixture.organizationId, name: 'Offline new tag' }),
		{ tier: 'remote' }
	)
	if (!transaction || !tag) return null
	const links = await db.all(app.transactionTags.where({ transactionId: transaction.id }), {
		tier: 'remote'
	})
	return { categoryId: tag.categoryId, tags: links.map((link) => link.tagId) }
}
