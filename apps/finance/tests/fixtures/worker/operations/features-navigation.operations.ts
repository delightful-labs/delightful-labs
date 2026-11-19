import { fixtureWindow as window } from '../state.js'

export const operation10 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	const workspace = await db
		.insert(app.organizations, {
			name: 'Navigation workspace',
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

export const operation61 = async () => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	return window.workspaceSettingsTest.db === getCurrentJazzSession()?.getSnapshot().client?.db
}
