import { RecoveryPhrase } from 'jazz-tools/passphrase'
import type { JazzSession } from 'jazz-tools/client'
import type { NativeRestorationCapability, RestorationScope } from '../../contracts/restoration.js'

type RestorationSession = Pick<JazzSession<unknown>, 'getSnapshot' | 'restoreDeviceAccount'>

export type JazzRestorationAdapter = Readonly<{
	binding: object
	capability: NativeRestorationCapability
	/** Host also sends BINDING_INVALIDATED; keep issued attempts alive until their output. */
	invalidate: () => void
}>

export async function parseJazzRecoveryPhrase(phrase: string) {
	return RecoveryPhrase.toSecret(phrase)
}

/** Host serializes identity-changing calls. No provider, observer, or credential cache is created. */
export function createJazzRestorationAdapter(
	session: RestorationSession,
	getSession: () => RestorationSession | null | undefined
): JazzRestorationAdapter {
	const binding = Object.freeze({})
	let boundSession: RestorationSession | undefined = session

	function currentSession(captured: object): RestorationSession | undefined {
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
			parsePhrase: parseJazzRecoveryPhrase,
			isCurrentBinding: (captured) => currentSession(captured) !== undefined,
			restoreIdentity: async (scope: RestorationScope, credential) => {
				const current = currentSession(scope.binding)
				if (!current) throw new Error('Restoration binding unavailable')
				// Adjacent invariant recheck followed by exactly one host-session SDK operation.
				return current.restoreDeviceAccount(credential)
			},
			readIdentity: async (scope) => {
				const snapshot = currentSession(scope.binding)?.getSnapshot()
				return snapshot?.status === 'ready' && snapshot.user
					? { kind: 'ready', identityId: snapshot.user.accountId }
					: { kind: 'unavailable' }
			}
		}
	}
}
