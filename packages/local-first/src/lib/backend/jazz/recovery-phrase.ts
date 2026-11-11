import { exportLocalFirstSecret, type AccountHandle } from 'jazz-tools'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import type {
	AvailableRecoveryScope,
	RecoveryPhraseCapability,
	RecoveryScope
} from '../../contracts/recovery-phrase.js'

export type JazzRecoveryAdapter = Readonly<{
	/** Call from the host's existing account observation before publishing the returned scope. */
	observeAccount: (account: AccountHandle | null | undefined) => RecoveryScope
	/** Release this adapter's observed handle. Publish the result if its source remains active. */
	invalidate: () => RecoveryScope
	capability: RecoveryPhraseCapability
}>

/** No client, provider, subscription, or credential store is created here. */
export function createJazzRecoveryAdapter(
	getAccount: () => AccountHandle | null | undefined
): JazzRecoveryAdapter {
	const binding = Object.freeze({})
	let observedAccount: AccountHandle | null = null
	let generation = 0
	let scope: RecoveryScope = { kind: 'unavailable' }

	// Primitive binding validation used by both the machine guard and its adjacent export recheck.
	function currentAccount(captured: AvailableRecoveryScope): AccountHandle | undefined {
		if (
			scope.kind !== 'available' ||
			!observedAccount ||
			captured.binding !== binding ||
			captured.generation !== generation ||
			captured.identityId !== observedAccount.id
		)
			return undefined

		try {
			return getAccount() === observedAccount ? observedAccount : undefined
		} catch {
			// A host snapshot getter failure cannot make an old binding current.
			return undefined
		}
	}

	return {
		observeAccount(account) {
			const next = account ?? null
			if (next === observedAccount) return scope
			observedAccount = next
			generation += 1
			scope =
				next?.identity.issuer === 'urn:jazz:local-first'
					? Object.freeze<AvailableRecoveryScope>({
							kind: 'available',
							identityId: next.id,
							binding,
							generation
						})
					: { kind: 'unavailable' }
			return scope
		},
		invalidate() {
			observedAccount = null
			generation += 1
			scope = { kind: 'unavailable' }
			return scope
		},
		capability: {
			isCurrentScope: (captured) => currentAccount(captured) !== undefined,
			readPhrase: async (captured) => {
				const account = currentAccount(captured)
				if (!account) throw new Error('Recovery scope unavailable')
				// Synchronous local export/encoding; no await, query, mutation, or acquired resource.
				return RecoveryPhrase.fromSecret(exportLocalFirstSecret(account))
			}
		}
	}
}
