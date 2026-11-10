import type {
	WorkerRequestIdentity,
	WorkerRequestReply,
	WorkerRequestResult
} from './worker-request.js'

export const MAX_WORKER_CHANNEL_REQUESTS = 8
/** Validate payloads before admission. A refused native post invalidates FIFO
 * continuity, so it must fail the channel rather than leave a sequence gap. */
export type WorkerChannelPostReceipt =
	| { kind: 'posted' }
	| { kind: 'not-issued'; reason: 'unavailable' }
export type WorkerHostClosed = Readonly<{ scope: string; requestId: string }>
export type WorkerChannelData<Response> =
	| { type: 'REPLY'; reply: WorkerRequestReply<Response> }
	| {
			type: 'TRANSPORT_FAILED'
			scope: string
			reason: 'closed' | 'unavailable' | 'invalid-reply'
	  }
export type WorkerChannelControl =
	| { type: 'HOST_CLOSED'; receipt: WorkerHostClosed }
	| { type: 'CLOSE_FAILED'; scope: string }
export type WorkerChannelResult<Response> =
	| WorkerRequestResult<Response>
	| {
			kind: 'refused'
			scope: string
			requestId: string
			reason: 'closed' | 'overloaded' | 'rejected' | 'unavailable'
			effectOutcome: 'not-issued'
	  }
export type WorkerChannelCall<Request, Response> = Readonly<{
	requestId: string
	request: Request
	effect: 'query' | 'effect'
	/** Pure protocol-specific predicate, after bounded wire decoding. */
	accept: (response: Response) => boolean
	/** Native observer boundary. A successful return accepts response custody. */
	settle: (result: WorkerChannelResult<Response>) => void
}>
export type WorkerChannelInput<Request, Response> = Readonly<{
	scope: string
	closeRequestId: string
	maxInFlight?: number
	requestTimeoutMs?: number
	closeTimeoutMs?: number
	post: (request: Request, identity: WorkerRequestIdentity) => WorkerChannelPostReceipt
	/** Wire adapter owns bounded validation and closes invalid transferred ports. */
	listenData: (report: (event: WorkerChannelData<Response>) => void) => () => void
	/** Must use an independent control transport, surviving data failure. */
	listenControl: (report: (event: WorkerChannelControl) => void) => () => void
	/** One native close request, never a promise asserting closure by timeout. */
	postClose: (identity: WorkerHostClosed) => void
	/** Release unclaimed successful responses, including orphaned transferred ports. */
	discard: (response: Response) => void
	onOverdue: (identity: WorkerHostClosed) => void
	onBlocked: (scope: string) => void
}>
