import { browser } from '$app/env'
import { createJazzSessionAcquisition } from 'delightful-local-first/backend/jazz/session'
import { createJazzStartupRegistry } from 'delightful-local-first/backend/jazz/startup'
import type { JazzClientConfig, JazzSession, JazzClient } from 'jazz-tools/client'
export type { JazzStartupBinding } from 'delightful-local-first/backend/jazz/startup'
// Stable loader identity lets layout reattachment reuse the retained owner.
export const loadLocalFirstClient = () => import('jazz-tools/local-first')
// The pinned SDK serializes this cross-worker contention as an Error message.
// Match only its exact busy shape; authentication, quota and other errors still fail.
function classifyStorageAvailability(error: unknown) {
	if (!(error instanceof Error)) return undefined
	const match =
		/^IndexedDB database (.+) is active in another Jazz SharedWorker realm; wait for that worker to close before retrying$/.exec(
			error.message
		)
	const databaseName = match?.[1]
	return databaseName
		? { resourceKey: `jazz:browser-physical-database:${databaseName}` }
		: undefined
}

function waitForStorageAvailability(resourceKey: string, signal: AbortSignal) {
	return navigator.locks.request(resourceKey, { mode: 'shared', signal }, () => {})
}

const registry = createJazzStartupRegistry((config) => {
	const acquisition = createJazzSessionAcquisition(config)
	return {
		...acquisition,
		capability: {
			...acquisition.capability,
			availability: { classify: classifyStorageAvailability, wait: waitForStorageAvailability }
		}
	}
})
export const getCurrentJazzSession = registry.getCurrentJazzSession
export const getCurrentSessionAvailability = registry.getCurrentSessionAvailability
export function getJazzStartupBinding(config: JazzClientConfig) {
	if (!browser) throw new Error('Jazz startup binding requires the browser')
	return registry.getJazzStartupBinding(config)
}

/** SDK preparation only; the application chart owns waiting and shutdown. */
export async function prepareLocalFirstSession(session: JazzSession<JazzClient>) {
	const db = session.getSnapshot().client?.db
	if (!db) throw new Error('Finance session unavailable')
	await db.upgradeToLocalFirst(loadLocalFirstClient)
}
