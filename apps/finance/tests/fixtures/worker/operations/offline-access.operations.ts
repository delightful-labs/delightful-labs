import type { OrganizationMember } from '#lib/queries.js'

type Scenario = {
	name: string
	role?: OrganizationMember['role']
	mode: OrganizationMember['accountAccessMode']
	grant?: 'read' | 'write'
	read: boolean
	write: boolean
}

import { fixtureWindow as window } from '../state.js'

export const operation57 = async (href: string) => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.user) throw new Error('Missing offline fixture identity')
	const organizationId = new URL(href).searchParams.get('workspace')
	if (!organizationId) throw new Error('Missing offline fixture workspace')
	return { userId: snapshot.user.accountId, organizationId }
}

export const operation76 = async ({
	owner,
	identity,
	scenario
}: {
	owner: { userId: string; organizationId: string }
	identity: { userId: string; organizationId: string }
	scenario: Scenario
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing owner database')
	const category = await db.one(
		app.categories.where({
			organizationId: owner.organizationId,
			kind: 'expense',
			isSystem: true
		})
	)
	if (!category) throw new Error('Missing expense category')
	const tx = db.beginTransaction()
	const account = tx.insert(app.accounts, {
		organizationId: owner.organizationId,
		name: 'Offline shared ledger',
		kind: 'cash',
		currency: 'USD'
	})
	const hiddenAccount = tx.insert(app.accounts, {
		organizationId: owner.organizationId,
		name: 'Other offline ledger',
		kind: 'cash',
		currency: 'USD'
	})
	const transaction = tx.insert(app.transactions, {
		organizationId: owner.organizationId,
		accountId: account.id,
		categoryId: category.id,
		kind: 'expense',
		amountMinor: 100,
		currency: 'USD',
		bookedOn: '2026-10-25',
		source: 'manual',
		description: 'Offline access fixture'
	})
	const hidden = tx.insert(app.transactions, {
		organizationId: owner.organizationId,
		accountId: hiddenAccount.id,
		categoryId: category.id,
		kind: 'expense',
		amountMinor: 200,
		currency: 'USD',
		bookedOn: '2026-10-25',
		source: 'manual',
		description: 'Other account fixture'
	})
	if (scenario.role)
		tx.insert(app.organizationMembers, {
			organizationId: owner.organizationId,
			userId: identity.userId,
			role: scenario.role,
			accountAccessMode: scenario.mode
		})
	if (scenario.grant)
		tx.insert(app.accountMemberships, {
			organizationId: owner.organizationId,
			userId: identity.userId,
			accountId: account.id,
			access: scenario.grant,
			canDelete: false
		})
	await tx.commit().wait({ tier: 'global' })
	return { transactionId: transaction.id, hiddenId: hidden.id }
}

export const operation150 = async ({
	organizationId,
	fixture
}: {
	organizationId: string
	fixture: { transactionId: string; hiddenId: string }
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing subject database')
	const rows = await db.all(app.transactions.where({ organizationId }), { tier: 'remote' })
	return {
		readable: rows.some((row) => row.id === fixture.transactionId),
		otherReadable: rows.some((row) => row.id === fixture.hiddenId)
	}
}

export const operation178 = async ({
	organizationId,
	fixture
}: {
	organizationId: string
	fixture: { transactionId: string; hiddenId: string }
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing offline database')
	const rows = await db.all(app.transactions.where({ organizationId }), {
		tier: 'local-first'
	})
	return {
		readable: rows.some((row) => row.id === fixture.transactionId),
		otherReadable: rows.some((row) => row.id === fixture.hiddenId)
	}
}

export const operation217 = async (id: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing owner verification database')
	return (await db.one(app.transactions.where({ id }), { tier: 'remote' }))?.amountMinor
}
