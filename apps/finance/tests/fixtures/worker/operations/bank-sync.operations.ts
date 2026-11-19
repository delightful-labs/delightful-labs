import { recordFixtureEffect } from '../effects.js'

import { fixtureWindow as window } from '../state.js'

export const operation18 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const attempts = await db.all(app.simplefinSyncAttempts)
	const accounts = await db.all(app.simplefinSyncAccountResults)
	return {
		attempts: attempts.map((row) => ({
			id: row.id,
			connectionId: row.connectionId,
			outcome: row.outcome,
			importedCount: row.importedCount,
			existingCount: row.existingCount,
			omittedCount: row.omittedCount,
			importSettlement: row.importSettlement
		})),
		accounts: accounts.map((row) => ({
			attemptId: row.attemptId,
			accountName: row.accountName,
			outcome: row.outcome,
			importedCount: row.importedCount,
			existingCount: row.existingCount,
			omittedCount: row.omittedCount
		}))
	}
}

export const operation249 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const session = getCurrentJazzSession()?.getSnapshot()
	const db = session?.client?.db,
		userId = session?.user?.accountId
	if (!db || !userId) throw new Error('Missing session')
	const [profile] = await db.all(app.profiles.where({ userId }))
	if (!profile) throw new Error('Missing profile')
	await db
		.update(app.profiles, profile.id, { displayName: 'Sync Operator' })
		.wait({ tier: 'local' })
}

export const operation324 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const links = await db.all(app.simplefinAccountLinks)
	return links.map(({ availableBalance, balanceDate }) => ({
		availableBalance,
		balanceDate: balanceDate?.toISOString()
	}))
}

export const operation345 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const rows = await db.all(app.transactions.where({ source: 'simplefin' }))
	const row = rows.find((value) => value.kind === 'expense')
	if (!row) throw new Error('Missing imported expense')
	await db
		.update(app.transactions, row.id, {
			description: 'User description',
			memo: 'User notes',
			amountMinor: 5678
		})
		.wait({ tier: 'global' })
	return { id: row.id, externalId: row.externalId }
}

export const operation370 = async (id: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const rows = await db.all(app.transactions.where({ source: 'simplefin' }), { tier: 'remote' })
	const row = rows.find((value) => value.id === id)
	return {
		count: rows.length,
		description: row?.description,
		memo: row?.memo,
		amountMinor: row?.amountMinor,
		externalId: row?.externalId
	}
}

export const operation438 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const connection = (await db.all(app.simplefinConnections)).find((row) => row.status === 'active')
	if (!connection?.ownerId) throw new Error('Missing owned connection')
	for (let index = 0; index < 21; index += 1) {
		const id = crypto.randomUUID()
		const startedAt = new Date(Date.UTC(2020, 0, 1, 0, 0, index))
		await db
			.insert(
				app.simplefinSyncAttempts,
				{
					organizationId: connection.organizationId,
					connectionId: connection.id,
					initiatedBy: connection.ownerId,
					startedAt,
					finishedAt: null,
					outcome: 'unfinished',
					importSettlement: 'notStarted',
					failureCode: null,
					importedCount: null,
					existingCount: null,
					omittedCount: null
				},
				{ id }
			)
			.wait({ tier: 'global' })
		if (index > 0)
			await db
				.update(app.simplefinSyncAttempts, id, {
					outcome: 'succeeded',
					finishedAt: startedAt,
					importedCount: 0,
					existingCount: 0,
					omittedCount: 0
				})
				.wait({ tier: 'global' })
	}
	const otherConnectionId = crypto.randomUUID()
	await db
		.insert(
			app.simplefinConnections,
			{
				organizationId: connection.organizationId,
				ownerId: connection.ownerId,
				accessUrl: '',
				status: 'revoked',
				claimedAt: new Date()
			},
			{ id: otherConnectionId }
		)
		.wait({ tier: 'global' })
	await db
		.insert(app.simplefinSyncAttempts, {
			organizationId: connection.organizationId,
			connectionId: otherConnectionId,
			initiatedBy: connection.ownerId,
			startedAt: new Date(),
			finishedAt: null,
			outcome: 'unfinished',
			importSettlement: 'notStarted',
			failureCode: null,
			importedCount: null,
			existingCount: null,
			omittedCount: null
		})
		.wait({ tier: 'global' })
	return {
		current: connection.id,
		other: otherConnectionId,
		organizationId: connection.organizationId
	}
}

export const operation960 = async (failure: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const prototype: object | null = Object.getPrototypeOf(db)
	if (!prototype) throw new Error('Missing database prototype')
	const method = failure === 'start' ? 'insert' : 'update'
	const original: unknown = Object.getOwnPropertyDescriptor(prototype, method)?.value
	if (typeof original !== 'function') throw new Error('Missing database method')
	Object.defineProperty(prototype, method, {
		configurable: true,
		writable: true,
		value: function (this: object, ...args: unknown[]): unknown {
			if (args[0] === app.simplefinSyncAttempts)
				throw new Error('Synthetic log persistence failure')
			return Reflect.apply(original, this, args)
		}
	})
}

export const operation998 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	return (await db.all(app.transactions)).filter(
		(row) => row.description === 'Import despite logging failure'
	).length
}

export const operation1066 = async (organizationId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot(),
		db = snapshot?.client?.db,
		userId = snapshot?.user?.accountId
	if (!db || !userId) throw new Error('Missing database/session')
	const connection = (await db.all(app.simplefinConnections.where({ organizationId }))).find(
		(row) => row.status === 'active'
	)
	if (!connection) throw new Error('Missing connected bank')
	const connectionId = connection.id,
		otherConnectionId = crypto.randomUUID(),
		accountId = crypto.randomUUID()
	const oldest = crypto.randomUUID(),
		child = crypto.randomUUID(),
		unfinished = crypto.randomUUID(),
		otherAttempt = crypto.randomUUID()
	await db
		.insert(
			app.accounts,
			{ organizationId, name: 'Retention ledger', kind: 'bank', currency: 'USD' },
			{ id: accountId }
		)
		.wait({ tier: 'global' })
	await Promise.all(
		Array.from({ length: 101 }, async (_, index) => {
			const id = index === 0 ? oldest : crypto.randomUUID(),
				time = new Date(Date.UTC(2020, 0, 1, 0, 0, index))
			await db
				.insert(
					app.simplefinSyncAttempts,
					{
						organizationId,
						connectionId,
						initiatedBy: userId,
						startedAt: time,
						outcome: 'unfinished',
						importSettlement: 'notStarted',
						importedCount: 0,
						existingCount: 0,
						omittedCount: 0
					},
					{ id }
				)
				.wait({ tier: 'global' })
			if (index === 0)
				await db
					.insert(
						app.simplefinSyncAccountResults,
						{
							organizationId,
							attemptId: id,
							accountId,
							accountName: 'Old bank ledger',
							outcome: 'succeeded',
							importedCount: 0,
							existingCount: 0,
							omittedCount: 0
						},
						{ id: child }
					)
					.wait({ tier: 'global' })
			await db
				.update(app.simplefinSyncAttempts, id, { outcome: 'succeeded', finishedAt: time })
				.wait({ tier: 'global' })
		})
	)
	await db
		.insert(
			app.simplefinSyncAttempts,
			{
				organizationId,
				connectionId,
				initiatedBy: userId,
				startedAt: new Date(),
				outcome: 'unfinished',
				importSettlement: 'notStarted'
			},
			{ id: unfinished }
		)
		.wait({ tier: 'global' })
	await db
		.insert(
			app.simplefinConnections,
			{
				organizationId,
				ownerId: userId,
				accessUrl: '',
				status: 'revoked',
				claimedAt: new Date()
			},
			{ id: otherConnectionId }
		)
		.wait({ tier: 'global' })
	await db
		.insert(
			app.simplefinSyncAttempts,
			{
				organizationId,
				connectionId: otherConnectionId,
				initiatedBy: userId,
				startedAt: new Date(),
				outcome: 'unfinished',
				importSettlement: 'notStarted'
			},
			{ id: otherAttempt }
		)
		.wait({ tier: 'global' })
	return { oldest, child, unfinished, otherAttempt, connectionId, otherConnectionId }
}

export const operation1267 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const userId = getCurrentJazzSession()?.getSnapshot().user?.accountId
	if (!userId) throw new Error('Missing identity')
	const profileQuery = app.profiles.where({ userId: { in: [userId] } })
	const blocked = profileQuery._build()
	let prototype: object | null = Object.getPrototypeOf(profileQuery)
	while (prototype && !Object.prototype.hasOwnProperty.call(prototype, '_build'))
		prototype = Object.getPrototypeOf(prototype)
	if (!prototype) throw new Error('Missing query builder prototype')
	const original: unknown = Object.getOwnPropertyDescriptor(prototype, '_build')?.value
	if (typeof original !== 'function') throw new Error('Missing query builder method')
	Object.defineProperty(prototype, '_build', {
		configurable: true,
		writable: true,
		value: function (this: object, ...args: unknown[]): unknown {
			const result: unknown = Reflect.apply(original, this, args)
			if (result === blocked) {
				recordFixtureEffect('profile-lookup-failed')
				throw new Error('Synthetic optional profile lookup failure')
			}
			return result
		}
	})
}

export const operation1428 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing SDK database')
	return (await db.all(app.transactions)).map(({ organizationId, description }) => ({
		organizationId,
		description
	}))
}

export const operation1509 = async ({
	provider,
	transactions
}: {
	provider: {
		id: string
		name: string
		currency: string
		org: { 'sfin-url': string; domain: string }
	}
	transactions: { id: string; amount: string; posted: number; description: string }[]
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const { stableUuid }: typeof import('#lib/domain/stable-uuid.js') =
		await import('#lib/domain/stable-uuid.js')
	const { providerAccountIdentity }: typeof import('#lib/integrations/simplefin.js') =
		await import('#lib/integrations/simplefin.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const [link] = await db.all(app.simplefinAccountLinks)
	if (!link) throw new Error('Missing linked account')
	const [category] = await db.all(
		app.categories.where({
			organizationId: link.organizationId,
			isSystem: true,
			kind: 'expense'
		})
	)
	if (!category) throw new Error('Missing system expense category')
	await Promise.all(
		transactions.slice(0, 225).map(async (raw) => {
			const externalId = JSON.stringify([providerAccountIdentity(provider), raw.id])
			const id = await stableUuid(link.organizationId, `simplefin-transaction:${externalId}`)
			await db
				.insert(
					app.transactions,
					{
						organizationId: link.organizationId,
						accountId: link.accountId,
						categoryId: category.id,
						kind: 'expense',
						bookedOn: '2026-10-14',
						amountMinor: 100,
						currency: 'USD',
						description: raw.description,
						source: 'simplefin',
						externalId
					},
					{ id }
				)
				.wait({ tier: 'global' })
		})
	)
}

export const operation1780 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing disposable test database')
	const accounts = await db.all(app.accounts)
	const links = await db.all(app.simplefinAccountLinks)
	const checking = accounts.find((account) => account.name === 'Reconnect Checking')
	if (!checking) throw new Error('Missing created checking account')
	await db.update(app.accounts, checking.id, { name: 'Renamed Checking' }).wait({ tier: 'local' })
	// Exercise missing-link recovery while retaining a second mapping unchanged.
	const removed = links.find((link) => link.accountId === checking.id)
	if (!removed) throw new Error('Missing original link')
	await db.delete(app.simplefinAccountLinks, removed.id).wait({ tier: 'local' })
	return {
		accountIds: accounts.map((account) => account.id).sort(),
		retained: links.filter((link) => link.id !== removed.id)
	}
}

export const operation1843 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing disposable test database')
	return {
		accountIds: (await db.all(app.accounts)).map((account) => account.id).sort(),
		links: await db.all(app.simplefinAccountLinks),
		transactions: await db.all(app.transactions)
	}
}
