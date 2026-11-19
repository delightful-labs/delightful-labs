import { fixtureWindow as window } from '../state.js'

export const operation9 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing session')
	const [org] = await db.all(app.organizations)
	if (!org) throw new Error('Missing workspace')
	const account = await db
		.insert(app.accounts, {
			organizationId: org.id,
			name: 'Editor ledger',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'local' })
	const category = await db
		.insert(app.categories, {
			organizationId: org.id,
			name: 'Editor category',
			kind: 'expense',
			isSystem: false
		})
		.wait({ tier: 'local' })
	const transaction = await db
		.insert(app.transactions, {
			organizationId: org.id,
			accountId: account.id,
			categoryId: category.id,
			amountMinor: 100,
			currency: 'USD',
			kind: 'expense',
			bookedOn: '2026-10-28',
			source: 'manual'
		})
		.wait({ tier: 'local' })
	return { transactionId: transaction.id, accountId: account.id, categoryId: category.id }
}

export const operation88 = async (transactionId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing session')
	const links = await db.all(
		app.transactionAttachments.where({ transactionId }).include({ file: { parts: true } }),
		{ tier: 'local-first' }
	)
	return links.map((link) => ({
		id: link.id,
		fileId: link.fileId,
		name: link.file?.fileName,
		type: link.file?.mimeType,
		size: link.file?.sizeBytes,
		bytes: [...(link.file?.parts ?? [])]
			.sort((a, b) => a.partIndex - b.partIndex)
			.flatMap(({ data }) => [...(data ?? [])])
	}))
}

export const operation215 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const row = await getCurrentJazzSession()
		?.getSnapshot()
		.client?.db.one(app.transactions.where({ description: 'Editor draft receipt' }), {
			tier: 'local-first'
		})
	return row?.id
}

export const operation323 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Missing session')
	const [membership] = await snapshot.client.db.all(
		app.organizationMembers.where({ userId: snapshot.user.accountId })
	)
	if (!membership) throw new Error('Missing membership')
	await snapshot.client.db
		.update(app.organizationMembers, membership.id, { role: 'viewer' })
		.wait({ tier: 'local' })
}
