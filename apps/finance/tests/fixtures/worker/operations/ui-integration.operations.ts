import type { Locator } from '@playwright/test'

import { fixtureWindow as window } from '../state.js'

export const operation117 = async () => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Test session is not ready.')
	await db.disconnect()
}
