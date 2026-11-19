import { JAZZ_RUNTIME_VERSION } from '../../offline/runtime-version.js'
import { createLibraryCapability } from './library.js'
import { createLibraryRecords } from './records.js'
import { readConnection } from './read-connection.js'
import { createLibraryBinding, createLibraryCapture } from './library-binding.js'
import wasmUrl from '#jazz-wasm-binary?url'
import type { JazzClientConfig } from 'jazz-tools/client'
import {
	type JazzSessionResource,
	createJazzStartupRegistry
} from 'delightful-local-first/backend/jazz/startup'
import { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'
import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import type {
	AccountHost,
	AccountInput,
	AccountObservation,
	AccountBinding,
	ReadyAccountObservation
} from '../../contracts/account.js'

export type Session = JazzSessionResource

export type LibraryFactory = typeof createLibraryCapability
function externallySignedIn(user: { kind: 'device' | 'backend' }) {
	return user.kind === 'backend'
}
function bindHost(
	resource: Session,
	libraryFactory: LibraryFactory,
	cacheNamespace: string
): AccountHost {
	const session = resource()
	const readiness = createJazzSessionReadinessAdapter(session)
	const recovery = createJazzRecoveryAdapter(() => session)
	const identities = new WeakMap<object, object>()
	const candidates = new WeakMap<ReadyAccountObservation, () => AccountBinding>()
	const identity = (resource: object) => {
		let token = identities.get(resource)
		if (!token) {
			token = Object.freeze({})
			identities.set(resource, token)
		}
		return token
	}
	const read = (): AccountObservation => {
		const snapshot = session.getSnapshot()
		recovery.observeSession()
		if (snapshot.status !== 'ready' || !snapshot.user || !snapshot.client) {
			return {
				status:
					snapshot.status === 'ready' || snapshot.status === 'starting' ? 'error' : snapshot.status
			}
		}
		const user = snapshot.user
		const client = snapshot.client
		const db = client.db
		const check = () => {
			const now = session.getSnapshot()
			if (
				now.status !== 'ready' ||
				now.user !== user ||
				now.client !== client ||
				now.client?.db !== db
			)
				throw new Error('Account scope expired')
		}
		const build = (live: () => boolean) => {
			const admitted = () => {
				check()
				if (!live()) throw new Error('Account scope expired')
			}
			const domain = createLibraryBinding({
				db,
				identityId: user.accountId,
				isCurrent: () => {
					check()
					return live()
				},
				libraryFactory,
				cacheNamespace
			})
			const observation: ReadyAccountObservation = {
				status: 'ready',
				localFirst: db.isLocalFirst(),
				binding: identity(user),
				clientBinding: identity(client),
				databaseBinding: identity(db),
				prepare: () => {
					admitted()
					return db.upgradeToLocalFirst(localFirst)
				},
				logout: () => {
					// Native mutation admission stays bound to the selected identity.
					admitted()
					return session.signOut()
				},
				logoutStatus: () => {
					const now = session.getSnapshot()
					if (
						now.status === 'signed-out' ||
						(now.status === 'ready' && now.user && !externallySignedIn(now.user))
					)
						return 'signed-out'
					if (now.status !== 'ready' || !now.user || !now.client) return 'unavailable'
					return now.user === user && now.client === client && now.client.db === db && live()
						? 'current'
						: 'replaced'
				},
				accountId: user.accountId,
				signedIn: externallySignedIn(user),
				root: domain.root,
				recovery: {
					capability: recovery.capability,
					source: {
						subscribe: (notify) => {
							const publish = () => notify(recovery.observeSession())
							publish()
							return session.subscribe(publish)
						}
					}
				}
			}
			return { observation, createLibrary: domain.createLibrary }
		}
		const { observation } = build(() => true)
		candidates.set(observation, () => {
			check()
			let released = false
			const live = () => !released
			const scoped = build(live)
			const adopted = { ...scoped.observation, library: scoped.createLibrary() }
			return {
				observation: adopted,
				release: () => {
					released = true
				}
			}
		})
		return observation
	}
	const restored = createJazzRestorationAdapter(session, () => session)
	return {
		read,
		adopt: (observation) => {
			const create = candidates.get(observation)
			if (!create) throw new Error('Account scope unavailable')
			candidates.delete(observation)
			return create()
		},
		readiness,
		create: () => session.createDeviceAccount(),
		signOut: async () => {
			const response = await fetch('/api/auth/sign-out', {
				method: 'POST',
				credentials: 'same-origin',
				redirect: 'error',
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			})
			if (!response.ok) throw new Error('Provider sign-out failed')
		},
		logout: () => session.signOut(),
		release: () => {
			recovery.invalidate()
			restored.invalidate()
		},
		restoration: restored
	}
}

// Constructing the registry is inert; only browser mount requests an attachment.
const registry = createJazzStartupRegistry()
const localFirst = () => import('jazz-tools/local-first')
const runtimeSources = Object.freeze({ wasmUrl, wasmVersion: JAZZ_RUNTIME_VERSION })
export function accountInput(
	config: JazzClientConfig,
	libraryFactory: LibraryFactory = createLibraryCapability
): AccountInput<Session> {
	// Match Finance: provision a local identity silently when no saved identity exists.
	return {
		startup: registry.getJazzStartupBinding({
			...config,
			client: localFirst,
			initial: 'device',
			localFirst: 'now',
			runtimeSources: config.runtimeSources ?? runtimeSources
		}),
		bind: (session) =>
			bindHost(
				session,
				libraryFactory,
				JSON.stringify([config.scope, config.serverUrl, config.env])
			)
	}
}

/** Existing identities/restoration only; extension sign-in must not create an unrelated account. */
export function existingAccountInput(
	config: JazzClientConfig,
	libraryFactory: LibraryFactory = createLibraryCapability
): AccountInput<Session> {
	return {
		startup: registry.getJazzStartupBinding({
			...config,
			client: localFirst,
			runtimeSources: config.runtimeSources ?? runtimeSources
		}),
		bind: (session) =>
			bindHost(
				session,
				libraryFactory,
				JSON.stringify([config.scope, config.serverUrl, config.env])
			)
	}
}

/** A consuming integration owns/drains the returned record actors before identity changes. */
export function currentLibraryRecords() {
	const session = registry.getCurrentJazzSession()
	const snapshot = session?.getSnapshot()
	if (!session || snapshot?.status !== 'ready' || !snapshot.user || !snapshot.client)
		throw new Error('Library scope unavailable')
	const { user, client } = snapshot
	return createLibraryRecords(
		client.db,
		user.accountId,
		() => {
			const now = session.getSnapshot()
			return now.status === 'ready' && now.user === user && now.client === client
		},
		readConnection(client.db)
	)
}

/** Guests send their native proof; backend users send their same-origin cookie. */
export async function requestCapture(
	operation: 'resolve' | 'extract' | 'asset',
	body: unknown,
	signal?: AbortSignal
) {
	const session = registry.getCurrentJazzSession()
	const snapshot = session?.getSnapshot()
	if (!session || snapshot?.status !== 'ready' || !snapshot.user || !snapshot.client)
		throw new Error('Account scope unavailable')
	const { user, client } = snapshot
	const db = client.db
	return createLibraryCapture(db, () => {
		const now = session.getSnapshot()
		return (
			now.status === 'ready' && now.user === user && now.client === client && now.client.db === db
		)
	})(operation, body, signal)
}
