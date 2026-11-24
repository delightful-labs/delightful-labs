import { createActor, toPromise, type OutputFrom } from 'xstate'
import { ReadTier } from 'jazz-tools'
import { createJazzClient } from 'jazz-tools/client'
import { browserAccountStore, fixtureServerUrl } from '../browser-account-store.js'
import { jazzRuntimeSources } from '../../src/lib/backend/jazz/runtime-sources.js'
import { createLibraryBinding } from '../../src/lib/backend/jazz/library-binding.js'
import { rootBootstrapMachine } from '../../src/lib/machines/runtime/root-bootstrap.js'
import { app } from '../../src/lib/backend/jazz/jazz.generated.js'
import type { RootAccess, RootWrite } from '../../src/lib/contracts/account.js'

// Explicit test-only Window driver. Each isolated browser context owns one real
// SDK session/store; no application layout or automatic bootstrap runs here.
let session: Awaited<ReturnType<typeof createJazzClient>> | undefined
let account: ReturnType<typeof browserAccountStore> | undefined
let initializer: ReturnType<typeof createActor<typeof rootBootstrapMachine>> | undefined
let completion: Promise<OutputFrom<typeof rootBootstrapMachine>> | undefined
let discovery: Awaited<ReturnType<RootAccess['read']>> | undefined
let barrier = Promise.withResolvers<void>()
const writes: Pick<RootWrite, 'global'>[] = []

function current() {
	const snapshot = session?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Native fixture identity unavailable')
	return { client: snapshot.client, identityId: snapshot.user.accountId }
}
export async function open(key?: string, inspectRoot = true) {
	if (session || account) throw new Error('Native fixture already open')
	const serverUrl = fixtureServerUrl()
	account = browserAccountStore(serverUrl)
	try {
		session = await createJazzClient({
			serverUrl,
			store: account.store,
			env: 'clipper',
			client: () => import('jazz-tools/local-first'),
			runtimeSources: jazzRuntimeSources,
			...(key ? {} : { initial: 'device' })
		})
		if (key) await session.restoreDeviceAccount(key)
		await current().client.db.upgradeToLocalFirst(() => import('jazz-tools/local-first'))
		return { identityId: current().identityId, roots: inspectRoot ? await localRoots() : undefined }
	} catch (error) {
		await close()
		throw error
	}
}
export function credential() {
	if (!session) throw new Error('Native fixture not open')
	return session.exportDeviceKey()
}
export async function localRoots() {
	const { client, identityId } = current()
	return (
		await client.db.all(app.libraries.where({ ownerId: identityId }), {
			tier: ReadTier.LocalFirst,
			firstLoadRemoteWaitMs: 0
		})
	).map((row) => ({ id: row.id, ownerId: row.ownerId, bootstrapVersion: row.bootstrapVersion }))
}
export async function remoteRoots() {
	const { client, identityId } = current()
	return (
		await client.db.all(app.libraries.where({ ownerId: identityId }), { tier: ReadTier.Remote })
	).map((row) => ({ id: row.id, ownerId: row.ownerId, bootstrapVersion: row.bootstrapVersion }))
}
function nativeBinding() {
	const { client, identityId } = current()
	return createLibraryBinding({
		db: client.db,
		identityId,
		workspaceId: identityId,
		isCurrent: () => session?.getSnapshot().client === client,
		libraryFactory: () => {
			throw new Error('Startup must not construct selected resources')
		},
		cacheNamespace: 'independent-native-startup'
	})
}
export function start() {
	if (initializer) throw new Error('Native initialization already started')
	const { identityId } = current()
	const native = nativeBinding()
	const root: RootAccess = {
		read: async () => {
			const observed = await native.root.read()
			discovery = observed
			await barrier.promise
			return observed
		},
		ensure: native.root.ensure
	}
	const actor = createActor(rootBootstrapMachine, { input: { db: root, userId: identityId } })
	completion = toPromise(actor)
	initializer = actor
	actor.start()
}
export function observedDiscovery() {
	return discovery
}
export function releaseDiscovery() {
	barrier.resolve()
}
export async function result() {
	if (!completion) throw new Error('Native initialization not started')
	const result = await completion
	if (result.outcome !== 'ready') return { outcome: result.outcome }
	if (result.persistence?.outcome === 'succeeded') writes.push(result.persistence.write)
	return {
		outcome: result.outcome,
		identityId: result.identityId,
		workspaceId: result.workspaceId,
		wrote: result.persistence?.outcome === 'succeeded'
	}
}
export async function accepted() {
	await Promise.all(writes.map((write) => write.global()))
	return remoteRoots()
}
export async function save(url: string) {
	const records = nativeBinding().createRecords()
	const result = await toPromise(
		createActor(records.articles.saveMachine, {
			input: {
				url,
				content: {
					title: 'Partial replica clip',
					text: 'Content retained across partial workspace startup.',
					html: '<p>Content retained across partial workspace startup.</p>',
					finalUrl: url,
					provenance: '{}'
				}
			}
		}).start()
	)
	if (result.kind === 'saved' || result.kind === 'duplicate') writes.push(...result.receipts)
	return result.kind
}
export async function documents(remote = false) {
	const { client, identityId } = current()
	return (
		await client.db.all(
			app.libraryDocuments.where({ libraryId: identityId }),
			remote ? { tier: ReadTier.Remote } : { tier: ReadTier.LocalFirst, firstLoadRemoteWaitMs: 0 }
		)
	).map((row) => ({ libraryId: row.libraryId, sourceUrl: row.sourceUrl }))
}
export async function close() {
	barrier.resolve()
	if (initializer?.getSnapshot().status === 'active') initializer.send({ type: 'SHUTDOWN' })
	await completion
	initializer?.stop()
	initializer = undefined
	completion = undefined
	try {
		await session?.close()
	} finally {
		session = undefined
		await account?.close()
		account = undefined
	}
	writes.length = 0
	discovery = undefined
	barrier = Promise.withResolvers<void>()
}
