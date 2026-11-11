import { RecoveryPhrase } from 'jazz-tools/passphrase'
import type { JazzSession } from 'jazz-tools/svelte'
import type { RestorationCapability, RestorationScope } from '../../contracts/restoration.js'

export type JazzRestorationAdapter = Readonly<{
	binding: object
	capability: RestorationCapability
	/** Host also sends BINDING_INVALIDATED; keep issued attempts alive until their output. */
	invalidate: () => void
}>

/** Host serializes identity-changing calls. No provider, observer, or credential cache is created. */
export function createJazzRestorationAdapter(
	session: JazzSession<unknown>,
	getSession: () => JazzSession<unknown> | null | undefined
): JazzRestorationAdapter {
	const binding = Object.freeze({})
	let boundSession: JazzSession<unknown> | undefined = session

	function currentSession(captured: object): JazzSession<unknown> | undefined {
		if (captured !== binding || !boundSession) return undefined
		try {
			return getSession() === boundSession ? boundSession : undefined
		} catch {
			return undefined
		}
	}

	return {
		binding,
		invalidate: () => {
			boundSession = undefined
		},
		capability: {
			parsePhrase: async (phrase) => RecoveryPhrase.toSecret(phrase),
			isCurrentBinding: (captured) => currentSession(captured) !== undefined,
			restoreIdentity: async (scope: RestorationScope, credential) => {
				const current = currentSession(scope.binding)
				if (!current) throw new Error('Restoration binding unavailable')
				// Adjacent invariant recheck followed by exactly one host-session SDK operation.
				return current.restoreLocalFirst(credential)
			},
			readIdentity: async (scope) => {
				const snapshot = currentSession(scope.binding)?.getSnapshot()
				return snapshot?.status === 'ready' && snapshot.account
					? { kind: 'ready', identityId: snapshot.account.id }
					: { kind: 'unavailable' }
			}
		}
	}
}
