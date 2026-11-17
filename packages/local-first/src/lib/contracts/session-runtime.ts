import type { SessionOpenCapability, SessionStatus } from './session.js'

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
}>

export type SessionRuntimeInput = Readonly<{
	binding: object
	capability: SessionOpenCapability<SessionRuntimeResource>
}>
export type SessionRuntimeResult =
	| Readonly<{ outcome: 'closed' }>
	| Readonly<{ outcome: 'failed'; stage: 'acquisition' | 'observation' }>
