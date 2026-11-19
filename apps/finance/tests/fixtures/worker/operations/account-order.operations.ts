import { fixtureWindow as window } from '../state.js'

export const operation9 = async (name: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Test session is not ready.')
	const db = snapshot.client.db
	const workspace = await db.one(
		app.organizations.where({ ownerId: snapshot.user.accountId, kind: 'personal' }),
		{ tier: 'local-first' }
	)
	if (!workspace) throw new Error('Test workspace is not ready.')
	await db
		.insert(app.accounts, { organizationId: workspace.id, name, kind: 'bank', currency: 'USD' })
		.wait({ tier: 'local' })
}

export const operation139 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Test session is not ready.')
	const db = snapshot.client.db
	const workspace = await db
		.insert(app.organizations, {
			name: 'Other workspace',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: snapshot.user.accountId
		})
		.wait({ tier: 'local' })
	await db
		.insert(app.organizationMembers, {
			organizationId: workspace.id,
			userId: snapshot.user.accountId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'local' })
	for (const name of ['Delta', 'Echo']) {
		await db
			.insert(app.accounts, {
				organizationId: workspace.id,
				name,
				kind: 'bank',
				currency: 'USD'
			})
			.wait({ tier: 'local' })
	}
	// Accounts must be created active; only the update policy allows archiving.
	const archived = await db
		.insert(app.accounts, {
			organizationId: workspace.id,
			name: 'Archived',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	await db.update(app.accounts, archived.id, { archivedAt: new Date() }).wait({ tier: 'global' })
	return workspace.id
}
