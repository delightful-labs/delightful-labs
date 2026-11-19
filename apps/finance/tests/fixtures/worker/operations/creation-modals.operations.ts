import { fixtureWindow as window } from '../state.js'

export const operation112 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const [account] = await db.all(app.accounts.where({ name: 'Modal checking' }))
	return account?.currency
}

export const operation152 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Test session is not ready.')
	const db = snapshot.client.db
	const workspace = await db
		.insert(app.organizations, {
			name: 'Second modal workspace',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: snapshot.user.accountId
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.organizationMembers, {
			organizationId: workspace.id,
			userId: snapshot.user.accountId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
	return workspace.id
}
