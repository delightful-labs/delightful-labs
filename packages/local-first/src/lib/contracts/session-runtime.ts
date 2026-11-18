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

/** Worker-local native facts and app capabilities. Domain readiness remains app-owned. */
export type SessionRuntimeObservation<Capabilities = undefined> =
	| Readonly<{
			status: 'ready'
			binding: object
			identityId: string
			identityKind: 'device' | 'backend'
			localFirst: boolean
			/** App-owned capability record; native handles remain in adapter closures. */
			capabilities: Capabilities
	  }>
	| Readonly<{ status: Exclude<SessionStatus, 'ready'> | 'starting' }>

/** Private native leaves. Their closures retain SDK resources; consumers use the actor. */
export type SessionRuntimeResource<Capabilities = undefined> = Readonly<{
	observe: (
		publish: (observation: SessionRuntimeObservation<Capabilities>) => void,
		failed: () => void
	) => () => void
	close: () => Promise<void>
	/** One native call after an adjacent binding recheck. Failure does not prove rollback. */
	signOut: (identityBinding: object) => Promise<'completed' | 'bindingChanged'>
}>

export type SessionRuntimeInput<Capabilities = undefined> = Readonly<{
	binding: object
	capability: SessionOpenCapability<SessionRuntimeResource<Capabilities>>
}>
export type SessionRuntimeResult =
	| Readonly<{ outcome: 'closed' }>
	| Readonly<{ outcome: 'failed'; stage: 'acquisition' | 'observation' }>
