import { fixtureWindow as window } from '../state.js'

export const operation38 = async ({
	organizationId,
	kind
}: {
	organizationId: string
	kind: 'expense' | 'income'
}) => {
	const { app, db, userId } = window.workspaceSettingsTest
	const second = await db
		.insert(app.organizations, {
			name: 'Form workspace',
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
	await db
		.insert(app.accounts, {
			organizationId,
			name: 'Personal checking',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.categories, {
			organizationId,
			name: 'Personal category',
			kind,
			isSystem: false
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.accounts, {
			organizationId: second.id,
			name: 'Business checking',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const archivedAccount = await db
		.insert(app.accounts, {
			organizationId: second.id,
			name: 'Archived checking',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	await db
		.update(app.accounts, archivedAccount.id, { archivedAt: new Date() })
		.wait({ tier: 'global' })
	await db
		.insert(app.categories, {
			organizationId: second.id,
			name: 'Business category',
			kind,
			isSystem: false
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.categories, {
			organizationId: second.id,
			name: 'Wrong kind category',
			kind: kind === 'expense' ? 'income' : 'expense',
			isSystem: false
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.categories, {
			organizationId: second.id,
			name: 'Archived category',
			kind,
			isSystem: false,
			archivedAt: new Date()
		})
		.wait({ tier: 'global' })
	return second.id
}

export const operation225 = async ({
	organizationId,
	memo
}: {
	organizationId: string
	memo: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	const rows = await db.all(app.transactions.where({ organizationId, memo }), {
		tier: 'remote'
	})
	const row = rows[0]
	return {
		rows,
		check: row?.checkId
			? await db.one(app.checks.where({ id: row.checkId }), { tier: 'remote' })
			: null
	}
}

export const operation278 = async ({
	organizationId,
	kind
}: {
	organizationId: string
	kind: 'expense' | 'income'
}) => {
	const { app, db, userId } = window.workspaceSettingsTest
	const system = await db.one(app.categories.where({ organizationId, kind, isSystem: true }), {
		tier: 'remote'
	})
	if (!system) throw new Error('System category is missing.')
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Default checking',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const custom = await db
		.insert(app.categories, {
			organizationId,
			name: 'Custom category',
			kind,
			isSystem: false
		})
		.wait({ tier: 'global' })
	const second = await db
		.insert(app.organizations, {
			name: 'Defaults workspace',
			kind: 'business',
			ownerId: userId,
			defaultCurrency: 'USD'
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
	const secondAccount = await db
		.insert(app.accounts, {
			organizationId: second.id,
			name: 'Second checking',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const secondSystem = await db
		.insert(app.categories, {
			organizationId: second.id,
			name: 'Renamed default',
			kind,
			isSystem: true
		})
		.wait({ tier: 'global' })
	return {
		systemId: system.id,
		accountId: account.id,
		customId: custom.id,
		secondWorkspaceId: second.id,
		secondAccountId: secondAccount.id,
		secondSystemId: secondSystem.id
	}
}

export const operation370 = async ({
	organizationId,
	memo
}: {
	organizationId: string
	memo: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	const rows = await db.all(app.transactions.where({ organizationId, memo }), {
		tier: 'remote'
	})
	return rows.map((row) => ({ categoryId: row.categoryId, kind: row.kind }))
}

export const operation393 = async ({
	organizationId,
	kind
}: {
	organizationId: string
	kind: 'expense' | 'income'
}) => {
	const { app, db } = window.workspaceSettingsTest
	await db
		.insert(app.categories, {
			organizationId,
			name: 'Live category',
			kind,
			isSystem: false
		})
		.wait({ tier: 'global' })
}
