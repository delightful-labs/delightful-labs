/** Non-secret scope only. The binding token must never be a database account handle. */
export type AvailableRecoveryScope = Readonly<{
	kind: 'available'
	identityId: string
	binding: object
	generation: number
}>

export type RecoveryScope = Readonly<{ kind: 'unavailable' }> | AvailableRecoveryScope

/** Host-owned observations. Subscribe publishes current scope and returns its own cleanup. */
export type RecoveryScopeSource = Readonly<{
	subscribe: (onScope: (scope: RecoveryScope) => void) => () => void
}>

/** Keep this capability stable for one actor lifetime; shut down before replacing it. */
export type RecoveryPhraseCapability = Readonly<{
	/** One resource-free leaf. Recheck the captured binding before exporting its phrase. */
	readPhrase: (scope: AvailableRecoveryScope) => Promise<string>
	/** Total, synchronous validity predicate over the host's current binding; no I/O. */
	isCurrentScope: (scope: AvailableRecoveryScope) => boolean
}>

export type RecoveryPhraseEvent =
	| { type: 'REVEAL' | 'RETRY' | 'HIDE' | 'COMPLETE' | 'SHUTDOWN' }
	| { type: 'CONFIRM'; value: boolean }
	| { type: 'OBSERVE'; scope: RecoveryScope }

/** The revealed variant is sensitive: do not log, persist, inspect, or retain old views. */
export type RecoveryPhraseView =
	| { kind: 'unavailable' | 'hidden' | 'revealing' | 'failed' | 'closed' }
	| { kind: 'revealed'; phrase: string; confirmation: 'unconfirmed' | 'confirmed' }
