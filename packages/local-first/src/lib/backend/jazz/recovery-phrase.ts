import type { JazzSession, JazzSessionSnapshot } from 'jazz-tools/client'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import type {
	AvailableRecoveryScope,
	RecoveryPhraseCapability,
	RecoveryScope
} from '../../contracts/recovery-phrase.js'

type RecoverySession = Pick<JazzSession<unknown>, 'getSnapshot' | 'exportDeviceKey'>

export type JazzRecoveryAdapter = Readonly<{
	/** Observe the host's existing session before publishing the returned scope. */
	observeSession: () => RecoveryScope
	invalidate: () => RecoveryScope
	capability: RecoveryPhraseCapability
}>

/** No client, provider, subscription, or credential store is created here. */
export function createJazzRecoveryAdapter(
	getSession: () => RecoverySession | null | undefined
): JazzRecoveryAdapter {
	const binding = Object.freeze({})
	let observedSession: RecoverySession | null = null
	let observedUser: JazzSessionSnapshot<unknown>['user'] = null
	let generation = 0
	let scope: RecoveryScope = { kind: 'unavailable' }

	function current() {
		const session = getSession() ?? null
		const snapshot = session?.getSnapshot()
		return {
			session,
			user: snapshot?.status === 'ready' && snapshot.user?.kind === 'device' ? snapshot.user : null
		}
	}

	// Check both the session and its public user binding, including before the
	// host forwards a new observation. Account ID equality alone is insufficient.
	function currentSession(captured: AvailableRecoveryScope) {
		if (
			scope.kind !== 'available' ||
			!observedSession ||
			!observedUser ||
			captured.binding !== binding ||
			captured.generation !== generation ||
			captured.identityId !== observedUser.accountId
		)
			return undefined
		try {
			const now = current()
			return now.session === observedSession && now.user === observedUser
				? observedSession
				: undefined
		} catch {
			return undefined
		}
	}

	return {
		observeSession() {
			const next = current()
			if (next.session === observedSession && next.user === observedUser) return scope
			observedSession = next.session
			observedUser = next.user
			generation += 1
			scope = next.user
				? Object.freeze<AvailableRecoveryScope>({
						kind: 'available',
						identityId: next.user.accountId,
						binding,
						generation
					})
				: { kind: 'unavailable' }
			return scope
		},
		invalidate() {
			observedSession = null
			observedUser = null
			generation += 1
			scope = { kind: 'unavailable' }
			return scope
		},
		capability: {
			isCurrentScope: (captured) => currentSession(captured) !== undefined,
			readPhrase: async (captured) => {
				const session = currentSession(captured)
				if (!session) throw new Error('Recovery scope unavailable')
				return RecoveryPhrase.fromSecret(session.exportDeviceKey())
			}
		}
	}
}
