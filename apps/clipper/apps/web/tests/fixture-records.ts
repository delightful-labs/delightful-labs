import { ReadTier } from 'jazz-tools'
import { app } from '../src/lib/backend/jazz/jazz.generated.js'
import { createJazzClient } from 'jazz-tools/client'
import { browserAccountStore, fixtureServerUrl } from './browser-account-store.js'
import { createLibraryRecords } from '../src/lib/backend/jazz/records.js'
import { readConnection } from '../src/lib/backend/jazz/read-connection.js'
import { jazzRuntimeSources } from '../src/lib/backend/jazz/runtime-sources.js'
/** Test fixture access only. The production UI never imports this Window client. */
const serverUrl = fixtureServerUrl()
const account = browserAccountStore(serverUrl)
const session = await createJazzClient({
	serverUrl,
	store: account.store,
	client: () => import('jazz-tools/local-first'),
	env: 'clipper',
	initial: 'device',
	runtimeSources: jazzRuntimeSources
}).catch(async (error) => {
	await account.close()
	throw error
})
let closing: Promise<void> | undefined
export function closeFixtureRecords() {
	return (closing ??= (async () => {
		try {
			await session.close()
		} finally {
			await account.close()
		}
	})())
}
try {
	await session.getSnapshot().client?.db.upgradeToLocalFirst(() => import('jazz-tools/local-first'))
	await ready()
} catch (error) {
	await closeFixtureRecords()
	throw error
}
window.closeClipperSeedReplica = closeFixtureRecords
/** Warm this independent test replica before taking its authority offline. */
export async function ready() {
	if (closing) throw new Error('Fixture replica closed')
	const { user, client } = session.getSnapshot()
	if (!user || !client) throw new Error('Fixture account unavailable')
	const library = await client.db.one(app.libraries.where({ id: user.accountId }), {
		tier: ReadTier.LocalFirst
	})
	if (!library) throw new Error('Fixture library unavailable')
}
export function currentLibraryRecords() {
	if (closing) throw new Error('Fixture replica closed')
	const { user, client } = session.getSnapshot()
	if (!user || !client) throw new Error('Fixture account unavailable')
	return createLibraryRecords(
		client.db,
		user.accountId,
		() => session.getSnapshot().client === client,
		readConnection(client.db)
	)
}
export function requestCapture(
	operation: 'resolve' | 'extract' | 'asset',
	body: unknown,
	signal?: AbortSignal
) {
	if (closing) throw new Error('Fixture replica closed')
	const token = session.getSnapshot().client?.db.getConfig().jwtToken
	if (!token) throw new Error('Fixture authentication unavailable')
	return fetch(`/api/capture/${operation}`, {
		method: 'POST',
		signal: signal ?? null,
		credentials: 'omit',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	})
}

declare global {
	interface Window {
		closeClipperSeedReplica?: typeof closeFixtureRecords
	}
}
