import type { SessionOpenCapability, SessionStatus } from './session.js'
import type { ActorRef, Readable, Snapshot } from 'xstate'
import type { RestorationScope } from './restoration.js'

/** Captured native identity; an unavailable/transitioning session cannot admit mutation. */
export type SessionRuntimeIdentity =
	| Readonly<{ status: 'ready'; binding: object }>
	| Readonly<{ status: 'signed-out'; binding: object }>
export type SessionRuntimeIdentityChange =
	| Readonly<{
			operation: 'create'
			before: Readonly<{ status: 'signed-out'; binding: object }> | undefined
	  }>
	| Readonly<{
			operation: 'restore'
			before: SessionRuntimeIdentity | undefined
			credential: string
	  }>
	| Readonly<{
			operation: 'signOut'
			before: Readonly<{ status: 'ready'; binding: object }> | undefined
	  }>
	| Readonly<{ operation: 'retry' }>
export type SessionRuntimeChangeOutcome =
	| 'completed'
	| 'failed'
	| 'bindingChanged'
	| 'unavailable'
	| 'busy'
	| 'invalidRequest'
export type SessionRuntimeChangeReport = Readonly<{
	type: 'SESSION_CHANGE_SETTLED'
	scope: RestorationScope
	operation: SessionRuntimeIdentityChange['operation']
	outcome: SessionRuntimeChangeOutcome
}>
export type SessionRuntimeChangeRequest = Readonly<{
	scope: RestorationScope
	change: SessionRuntimeIdentityChange
	replyTo: ActorRef<Snapshot<unknown>, SessionRuntimeChangeReport>
}>

export type SessionRuntimeView<Capabilities = unknown> = Readonly<{
	stage: 'acquiring' | 'openFailed' | 'observerFailed' | 'active' | 'closing' | 'closed' | 'failed'
	status: SessionStatus | 'starting'
	observation: SessionRuntimeObservation<Capabilities> | undefined
}>
/** Native XState reference and selection, local to the owning worker/host. */
export type SessionRuntimeConnection<Capabilities = unknown> = Readonly<{
	owner: ActorRef<
		Snapshot<unknown>,
		({ type: 'CHANGE_IDENTITY' } & SessionRuntimeChangeRequest) | { type: 'CLOSE' | 'RETRY' }
	>
	binding: object
	view: Readable<SessionRuntimeView<Capabilities>>
}>
export type SessionRuntimeChangeInput = Readonly<{
	session: SessionRuntimeConnection
	scope: RestorationScope
	change: SessionRuntimeIdentityChange
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
	| Readonly<{ status: 'signed-out'; binding: object }>
	| Readonly<{ status: Exclude<SessionStatus, 'ready' | 'signed-out'> | 'starting' }>

/** Private native leaves. Their closures retain SDK resources; consumers use the actor. */
export type SessionRuntimeResource<Capabilities = undefined> = Readonly<{
	observe: (
		publish: (observation: SessionRuntimeObservation<Capabilities>) => void,
		failed: () => void
	) => () => void
	close: () => Promise<void>
	/** One native call after an adjacent binding recheck. Failure does not prove rollback. */
	changeIdentity: (change: SessionRuntimeIdentityChange) => Promise<'completed' | 'bindingChanged'>
}>

export type SessionRuntimeInput<Capabilities = undefined> = Readonly<{
	binding: object
	capability: SessionOpenCapability<SessionRuntimeResource<Capabilities>>
}>
export type SessionRuntimeResult =
	| Readonly<{ outcome: 'closed' }>
	| Readonly<{ outcome: 'failed'; stage: 'acquisition' | 'observation' }>
