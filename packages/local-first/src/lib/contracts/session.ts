/** Non-secret correlation. Attachment tokens are unique to one attachment lifetime. */
export type SessionScope = Readonly<{
	binding: object
	attachment: object
	generation: number
}>

export type SessionFailure = 'openFailed' | 'invalidRequest' | 'ownerFailed'

/** One backend creation call; cache, sharing, retry, and release belong in the owner machine. */
export type SessionOpenCapability<Session extends object> = Readonly<{
	open: () => Promise<Session>
}>

/** Private integration messages: session payloads must never be serialized or inspected. */
export type SessionOwnerReply<Session extends object> =
	| Readonly<{ type: 'ACQUIRED'; scope: SessionScope; session: Session }>
	| Readonly<{ type: 'ACQUISITION_FAILED'; scope: SessionScope; reason: SessionFailure }>
	| Readonly<{ type: 'RELEASED'; scope: SessionScope }>

export type SessionStartupReport<Session extends object> =
	| Readonly<{ type: 'SESSION_STARTING'; scope: SessionScope }>
	| Readonly<{ type: 'SESSION_ACQUIRED'; scope: SessionScope; session: Session }>
	| Readonly<{ type: 'SESSION_STARTUP_FAILED'; scope: SessionScope; reason: SessionFailure }>

export type SessionStartupOutput = Readonly<{ outcome: 'closed' }>

/** SDK status only: never a workspace permission, remote freshness, or retry-settlement claim. */
export type SessionStatus = 'ready' | 'signed-out' | 'transitioning' | 'error' | 'closed'
export type SessionReadinessScope = Readonly<{ binding: object; attachment: object }>
export type SessionReadinessCapability = Readonly<{
	readStatus: () => SessionStatus
	subscribe: (notify: () => void) => () => void
	retry: () => Promise<void>
}>
export type SessionReadinessBinding = Readonly<{
	binding: object
	capability: SessionReadinessCapability
}>
export type SessionObservationFailure = 'readFailed' | 'subscribeFailed' | 'observerFailed'
export type SessionReadinessReport =
	| Readonly<{
			type: 'SESSION_STATUS'
			scope: SessionReadinessScope
			observation: number
			status: SessionStatus
			afterRetry: number | undefined
	  }>
	| Readonly<{
			type: 'SESSION_OBSERVATION_FAILED'
			scope: SessionReadinessScope
			observation: number
			reason: SessionObservationFailure
	  }>
	| Readonly<{
			type: 'SESSION_OBSERVATION_CLEANUP_FAILED'
			scope: SessionReadinessScope
			observation: number
	  }>
	| Readonly<{
			type: 'SESSION_RETRY_STARTED'
			scope: SessionReadinessScope
			attempt: number
	  }>
	| Readonly<{
			type: 'SESSION_RETRY_SETTLED'
			scope: SessionReadinessScope
			attempt: number
			outcome: 'resolved' | 'rejected'
	  }>
