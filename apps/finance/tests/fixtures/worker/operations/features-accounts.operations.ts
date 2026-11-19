import type { OrganizationMember } from '#lib/queries.js'

import { fixtureWindow as window } from '../state.js'

export const operation68 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	const workspace = await db
		.insert(app.organizations, {
			name: 'Account form workspace',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: userId
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.organizationMembers, {
			organizationId: workspace.id,
			userId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
	return workspace.id
}

export const operation124 = async (organizationId: string) => {
	const { app, db, userId } = window.workspaceSettingsTest
	const second = await db
		.insert(app.organizations, {
			name: 'Other ledger',
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
	const accounts = [
		{ organizationId, name: 'Zebra checking', kind: 'bank', archivedAt: null },
		{ organizationId, name: 'Alpha cash', kind: 'cash', archivedAt: null },
		{ organizationId, name: 'Archived card', kind: 'card', archivedAt: new Date() },
		{ organizationId: second.id, name: 'Business card', kind: 'card', archivedAt: null }
	] satisfies Pick<
		import('#lib/queries.js').Account,
		'organizationId' | 'name' | 'kind' | 'archivedAt'
	>[]
	const ids: string[] = []
	for (const account of accounts) {
		const row = await db
			.insert(app.accounts, { ...account, archivedAt: null, currency: 'USD' })
			.wait({ tier: 'global' })
		if (account.archivedAt)
			await db
				.update(app.accounts, row.id, { archivedAt: account.archivedAt })
				.wait({ tier: 'global' })
		ids.push(row.id)
	}
	return { secondWorkspaceId: second.id, firstAccountId: ids[0] }
}

export const operation174 = async (id: string | undefined) => {
	if (!id) throw new Error('Test account is missing.')
	const { app, db } = window.workspaceSettingsTest
	await db.update(app.accounts, id, { archivedAt: new Date() }).wait({ tier: 'global' })
}

export const operation189 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Archive checking',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const category = await db.one(
		app.categories.where({ organizationId, kind: 'expense', isSystem: true }),
		{ tier: 'remote' }
	)
	if (!category) throw new Error('Expense category is missing.')
	const transaction = await db
		.insert(app.transactions, {
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 1200,
			currency: 'USD',
			bookedOn: '2026-10-13',
			source: 'manual',
			description: 'Retained archived history'
		})
		.wait({ tier: 'global' })
	return { accountId: account.id, transactionId: transaction.id }
}

export const operation238 = async (fixture: { accountId: string; transactionId: string }) => {
	const { app, db } = window.workspaceSettingsTest
	const account = await db.one(app.accounts.where({ id: fixture.accountId }), {
		tier: 'remote'
	})
	const transaction = await db.one(app.transactions.where({ id: fixture.transactionId }), {
		tier: 'remote'
	})
	return {
		archived: Boolean(account?.archivedAt),
		retained: transaction?.id === fixture.transactionId
	}
}

export const operation303 = () => window.workspaceSettingsTest.userId

export const operation304 = async ({
	organizationId,
	subjectId,
	scenario
}: {
	organizationId: string
	subjectId: string
	scenario: {
		name: string
		role: NonNullable<OrganizationMember['role']>
		mode: OrganizationMember['accountAccessMode']
		grant?: 'read' | 'write'
		write: boolean
	}
}) => {
	const { app, db } = window.workspaceSettingsTest
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Permission checking',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.organizationMembers, {
			organizationId,
			userId: subjectId,
			role: scenario.role,
			accountAccessMode: scenario.mode
		})
		.wait({ tier: 'global' })
	if (scenario.grant)
		await db
			.insert(app.accountMemberships, {
				organizationId,
				accountId: account.id,
				userId: subjectId,
				access: scenario.grant,
				canDelete: false
			})
			.wait({ tier: 'global' })
	return account.id
}

export const operation363 = async (accountId: string) => {
	const { app, db } = window.workspaceSettingsTest
	try {
		await db.update(app.accounts, accountId, { archivedAt: new Date() }).wait({ tier: 'global' })
		return 'accepted'
	} catch (error) {
		return error instanceof Error ? error.message : 'unknown-error'
	}
}

export const operation378 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	const account = await db.one(app.accounts.where({ id }), { tier: 'remote' })
	return { exists: Boolean(account), archived: Boolean(account?.archivedAt) }
}
