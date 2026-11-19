import { fixtureWindow as window } from '../state.js'

export const operation12 = async ({
	count,
	acrossDates
}: {
	count: number
	acrossDates: boolean
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Session not ready')
	const db = snapshot.client.db
	const organization = await db.one(
		app.organizations.where({ ownerId: snapshot.user.accountId, kind: 'personal' }),
		{ tier: 'local-first' }
	)
	if (!organization) throw new Error('Workspace not ready')
	const categories = await db.all(
		app.categories.where({ organizationId: organization.id, kind: 'expense' }),
		{ tier: 'local-first' }
	)
	const category = categories[0]
	if (!category) throw new Error('Category not ready')
	const write = await db.transaction((tx) => {
		const account = tx.insert(app.accounts, {
			organizationId: organization.id,
			name: 'Pagination account',
			kind: 'bank',
			currency: 'USD'
		})
		for (let index = 0; index < count; index += 1) {
			tx.insert(app.transactions, {
				organizationId: organization.id,
				accountId: account.id,
				categoryId: category.id,
				amountMinor: 100,
				currency: 'USD',
				kind: 'expense',
				bookedOn: acrossDates
					? index < 10
						? '2026-10-19'
						: index < 30
							? '2026-10-18'
							: '2026-10-17'
					: '2026-10-19',
				description: `Pagination fixture ${index + 1}`,
				source: 'manual'
			})
		}
	})
	await write.wait({ tier: 'global' })
}

export const operation306 = async (href: string) => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing sample session')
	const organizationId = new URL(href).searchParams.get('workspace')
	if (!organizationId) throw new Error('Missing workspace scope')
	return (
		await db.all(app.transactions.where({ organizationId, kind: 'expense' }), {
			tier: 'remote'
		})
	).length
}

export const operation338 = async (count: number, href: string) => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing pagination session')
	const organizationId = new URL(href).searchParams.get('workspace')
	if (!organizationId) throw new Error('Missing workspace scope')
	const rows = await db.all(app.transactions.where({ organizationId, kind: 'expense' }))
	const tx = db.beginTransaction()
	for (const row of rows.slice(count)) tx.delete(app.transactions, row.id)
	await tx.commit().wait({ tier: 'global' })
}

export const operation380 = async (href: string) => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Missing sample session')
	const db = snapshot.client.db
	const sourceId = new URL(href).searchParams.get('workspace')
	if (!sourceId) throw new Error('Missing source scope')
	const tx = db.beginTransaction()
	const destination = tx.insert(app.organizations, {
		name: 'Batch replacement workspace',
		kind: 'personal',
		ownerId: snapshot.user.accountId,
		defaultCurrency: 'USD'
	})
	tx.insert(app.organizationMembers, {
		organizationId: destination.id,
		userId: snapshot.user.accountId,
		role: 'owner',
		accountAccessMode: 'all'
	})
	tx.insert(app.accounts, {
		organizationId: destination.id,
		name: 'Replacement ledger',
		kind: 'bank',
		currency: 'USD'
	})
	for (const kind of ['income', 'expense'] satisfies ('income' | 'expense')[])
		tx.insert(app.categories, {
			organizationId: destination.id,
			name: 'Uncategorized',
			kind,
			isSystem: true
		})
	await tx.commit().wait({ tier: 'global' })
	const gate = Promise.withResolvers<void>()
	const begin = db.beginTransaction.bind(db)
	let first = true
	window.paginationBatchGate = {
		started: false,
		release: () => gate.resolve(),
		restore: () => {
			Object.defineProperty(db, 'beginTransaction', {
				configurable: true,
				writable: true,
				value: begin
			})
		}
	}
	Object.defineProperty(db, 'beginTransaction', {
		configurable: true,
		writable: true,
		value: (...args: Parameters<typeof begin>) => {
			const transaction = begin(...args)
			if (!first) return transaction
			first = false
			const commit = transaction.commit.bind(transaction)
			transaction.commit = (...args) => {
				const handle = commit(...args)
				const wait = handle.wait.bind(handle)
				handle.wait = async (...options) => {
					const [option] = options
					const result = await wait({ tier: option.tier })
					window.paginationBatchGate.started = true
					await gate.promise
					return result
				}
				return handle
			}
			return transaction
		}
	})
	return { sourceId, destinationId: destination.id }
}

export const operation465 = () => window.paginationBatchGate.started

export const operation474 = () => window.paginationBatchGate.release()

export const operation480 = async ({
	sourceId,
	destinationId
}: {
	sourceId: string
	destinationId: string
}) => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing sample session')
	const rows = await db.all(app.transactions, { tier: 'remote' })
	return {
		source: rows.filter((row) => row.organizationId === sourceId).length,
		destination: rows.filter((row) => row.organizationId === destinationId).length
	}
}

export const operation497 = () => {
	window.paginationBatchGate.release()
	window.paginationBatchGate.restore()
}
