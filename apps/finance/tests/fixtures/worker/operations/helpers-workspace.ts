import type { ConsoleMessage, Page } from '@playwright/test'

import { fixtureWindow as window } from '../state.js'

export const operation38 = async () => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	return Boolean(snapshot?.client && snapshot.user)
}

export const operation48 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Test session is not ready.')
	window.workspaceSettingsTest = {
		db: snapshot.client.db,
		app,
		userId: snapshot.user.accountId
	}
}
