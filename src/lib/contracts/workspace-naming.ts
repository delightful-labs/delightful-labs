/** One explicit operation; Scope and Settings remain owned by the consumer. */
export type WorkspaceNamingRequest<Scope, Settings> = Readonly<{
	scope: Scope
	workspaceId: string
	name: string
	/** Saved with the name in one update, e.g. consumer-owned workspace settings. */
	settings: Settings
}>
export type WorkspaceNamingAssessment<Reason> =
	| Readonly<{ kind: 'allowed' }>
	| Readonly<{ kind: 'blocked'; reason: Reason }>
export type WorkspaceNamingSettlement =
	| Readonly<{ kind: 'notStarted' | 'locallyPersisted' }>
	| Readonly<{ kind: 'unknown'; error: unknown }>
export type WorkspaceNamingOutcome<Reason> =
	| Readonly<{ outcome: 'invalid'; settlement: { kind: 'notStarted' } }>
	| Readonly<{ outcome: 'blocked'; reason: Reason; settlement: { kind: 'notStarted' } }>
	| Readonly<{
			outcome: 'failed'
			error: unknown
			settlement: { kind: 'notStarted' } | { kind: 'unknown'; error: unknown }
	  }>
	| Readonly<{ outcome: 'succeeded'; settlement: { kind: 'locallyPersisted' } }>
	| Readonly<{
			outcome: 'cancelled' | 'invalidated' | 'closed'
			settlement: WorkspaceNamingSettlement
	  }>
export type WorkspaceNamingResult<Scope, Settings, Reason> = WorkspaceNamingOutcome<Reason> &
	Readonly<{ request: WorkspaceNamingRequest<Scope, Settings> }>
export type WorkspaceNamingEvent = Readonly<{ type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN' }>
/** No capability may hide a multi-step workflow or remote readiness gate. */
export type WorkspaceNamingCapability<Scope, Settings, Reason, Write> = Readonly<{
	/** Side-effect-free assessment of current local facts; the host owns role/schema policy. */
	assess: (request: WorkspaceNamingRequest<Scope, Settings>) => WorkspaceNamingAssessment<Reason>
	/** Issue one update; the envelope keeps a thenable SDK receipt opaque until persistLocal. */
	issue: (
		request: WorkspaceNamingRequest<Scope, Settings>
	) => Readonly<{ write: Write }> | PromiseLike<Readonly<{ write: Write }>>
	persistLocal: (write: Write) => void | PromiseLike<void>
}>
