/** Non-secret correlation. Advance attempt for each operation within a fixed host binding. */
export type RestorationScope = Readonly<{ binding: object; attempt: number }>

export type RestorationIdentity =
	| Readonly<{ kind: 'ready'; identityId: string }>
	| Readonly<{ kind: 'unavailable' }>

/** Fixed leaf dependencies. Credentials and raw SDK errors must never enter diagnostics. */
export type RestorationCapability = Readonly<{
	parsePhrase: (phrase: string) => Promise<string>
	/** Optional provider cookie/session clearance after validation and host drain. */
	clearProviderSession?: () => Promise<void>
	/** Total, synchronous predicate; checks session/environment, not the changing account. */
	isCurrentBinding: (binding: object) => boolean
	/** One issued operation. Settlement/rejection does not promise rollback or cancellation. */
	readIdentity: (scope: RestorationScope) => Promise<RestorationIdentity>
}> &
	(
		| Readonly<{
				restoreIdentity: (scope: RestorationScope, credential: string) => Promise<void>
				runtime?: never
		  }>
		| Readonly<{
				runtime: import('./session-runtime.js').SessionRuntimeConnection
				restoreIdentity?: never
		  }>
	)

export type NativeRestorationCapability = Extract<
	RestorationCapability,
	{ restoreIdentity: (scope: RestorationScope, credential: string) => Promise<void> }
>

export type RestorationReport = RestorationScope &
	(
		| Readonly<{ type: 'RESTORATION_VALIDATED' }>
		| Readonly<{ type: 'RESTORATION_PREPARE_REQUESTED' }>
	)

export type RestorationEvent =
	| (RestorationScope & Readonly<{ type: 'PREPARED' }>)
	| Readonly<{ type: 'CANCEL' | 'SHUTDOWN' | 'BINDING_INVALIDATED' }>

/** Settled means the restoration invocation settled, not proof of a changed or ready identity. */
export type RestorationResult = RestorationScope &
	(
		| Readonly<{ outcome: 'invalid'; mutation: 'notStarted' }>
		| Readonly<{ outcome: 'cancelled'; mutation: 'notStarted' | 'settled' }>
		| Readonly<{ outcome: 'failed'; mutation: 'notStarted' | 'settled' }>
		| Readonly<{ outcome: 'identityUnavailable'; mutation: 'settled' }>
		| Readonly<{ outcome: 'restored'; mutation: 'settled'; identityId: string }>
	)
