import type { SessionOpenCapability, SessionStatus } from './session.js'
import type { ActorRef, Snapshot } from 'xstate'
import type { RestorationScope } from './restoration.js'

export type SessionRuntimeSignOutOutcome =
	| 'completed'
	| 'failed'
	| 'bindingChanged'
	| 'unavailable'
	| 'busy'
	| 'invalidRequest'
export type SessionRuntimeSignOutReport = Readonly<{
	type: 'SESSION_SIGN_OUT_SETTLED'
	scope: RestorationScope
	outcome: SessionRuntimeSignOutOutcome
}>
export type SessionRuntimeSignOutRequest = Readonly<{
	scope: RestorationScope
	identityBinding: object
	replyTo: ActorRef<Snapshot<unknown>, SessionRuntimeSignOutReport>
}>

/** Native observations only. Application/domain readiness remains with its owner. */
export type SessionRuntimeObservation =
	| Readonly<{
			status: 'ready'
			binding: object
			identityId: string
			identityKind: 'device' | 'backend'
			localFirst: boolean
	  }>
	| Readonly<{ status: Exclude<SessionStatus, 'ready'> | 'starting' }>

/** Private native leaves. Their closures retain SDK resources; consumers use the actor. */
export type SessionRuntimeResource = Readonly<{
	observe: (
		publish: (observation: SessionRuntimeObservation) => void,
		failed: () => void
	) => () => void
	close: () => Promise<void>
	/** One native call after an adjacent binding recheck. Failure does not prove rollback. */
	signOut: (identityBinding: object) => Promise<'completed' | 'bindingChanged'>
}>

export type SessionRuntimeInput = Readonly<{
	binding: object
	capability: SessionOpenCapability<SessionRuntimeResource>
}>
export type SessionRuntimeResult =
	| Readonly<{ outcome: 'closed' }>
	| Readonly<{ outcome: 'failed'; stage: 'acquisition' | 'observation' }>
