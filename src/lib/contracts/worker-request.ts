export const DEFAULT_WORKER_REQUEST_TIMEOUT_MS = 10_000

/** A channel incarnation, never an account key reused after replacement. */
export type WorkerRequestIdentity = Readonly<{
	scope: string
	requestId: string
	sequence: number
}>
export type WorkerRequestFailureReason =
	| 'closed'
	| 'timeout'
	| 'unavailable'
	| 'rejected'
	| 'invalid-reply'
	| 'overloaded'
export type WorkerEffectOutcome = 'not-issued' | 'unknown'

/** The native adapter may assert not-issued only with evidence that posting did
 * not execute. An unexpected throw is deliberately not such a receipt. */
export type WorkerPostReceipt =
	| { kind: 'posted' }
	| { kind: 'not-issued'; reason: 'unavailable' | 'rejected' }
export type WorkerRequestInput<Request> = Readonly<{
	identity: WorkerRequestIdentity
	request: Request
	effect: 'query' | 'effect'
	timeoutMs?: number
	post: (request: Request, identity: WorkerRequestIdentity) => WorkerPostReceipt
}>

/** Protocol adapters validate/decode wire shapes before reporting these facts. */
export type WorkerRequestReply<Response> = Readonly<{ identity: WorkerRequestIdentity }> &
	(
		| { kind: 'succeeded'; response: Response }
		| {
				kind: 'failed'
				reason: 'rejected' | 'unavailable' | 'invalid-reply'
				effectOutcome: WorkerEffectOutcome
		  }
	)
export type WorkerRequestResult<Response> =
	| { kind: 'succeeded'; identity: WorkerRequestIdentity; response: Response }
	| {
			kind: 'failed'
			identity: WorkerRequestIdentity
			reason: WorkerRequestFailureReason
			effectOutcome: WorkerEffectOutcome
	  }
