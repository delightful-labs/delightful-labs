import { fixtureWindow as window } from '../state.js'

export const operation97 = async () => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const id = getCurrentJazzSession()?.getSnapshot().user?.accountId
	if (!id) throw new Error('Missing subject identity')
	return id
}

export const operation105 = async ({
	organizationId,
	subjectId,
	role
}: {
	organizationId: string
	subjectId: string
	role: string
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing owner database')
	if (role !== 'admin' && role !== 'member' && role !== 'viewer') throw new Error('Invalid role')
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
	if (!uuid.test(organizationId) || !uuid.test(subjectId))
		throw new Error(
			`Invalid membership UUIDs: organization=${organizationId}, subject=${subjectId}`
		)
	const membership = await db
		.insert(app.organizationMembers, {
			organizationId,
			userId: subjectId,
			role,
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
	return membership.id
}

export const operation160 = async (membershipId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing owner database')
	await db
		.update(app.organizationMembers, membershipId, { role: 'viewer' })
		.wait({ tier: 'global' })
}

export const operation183 = async (organizationId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing subject database')
	try {
		await db
			.insert(app.accounts, {
				organizationId,
				name: 'Forbidden',
				kind: 'bank',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		return false
	} catch {
		return true
	}
}
