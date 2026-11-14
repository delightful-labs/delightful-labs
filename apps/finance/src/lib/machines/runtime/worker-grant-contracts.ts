import type { ActorRef, Snapshot } from 'xstate'
import type { BrokerHostCall } from 'delightful-local-first/backend/jazz/worker-broker'
import type {
	WorkerChannelPostReceipt,
	WorkerHostClosed,
	WorkerHostCloseFailure
} from 'delightful-local-first/worker/channel/contracts'
import type {
	FinanceGrantIdentity,
	FinanceGrantReply,
	FinanceGrantRequest
} from '../../runtime/worker/grant-protocol.js'

export type FinanceAcquiredGrant = Extract<FinanceGrantReply, { type: 'GRANT_READY' }>
export type FinanceGrantRefusal = Extract<FinanceGrantReply, { type: 'GRANT_REFUSED' }>
export type FinanceGrantUncertain = Extract<FinanceGrantReply, { type: 'GRANT_UNCERTAIN' }>
export type FinanceGrantIssue =
	| { kind: 'acquisition-overdue' | 'acquisition-uncertain' | 'post-error' }
	| { kind: 'acquisition-refused'; reason: FinanceGrantRefusal['reason'] }
	| { kind: 'channel-overdue' | 'channel-blocked' | 'channel-closed' }
	| { kind: 'native-close-failed'; failure: WorkerHostCloseFailure }
export type FinanceGrantOwnerReport =
	| { type: 'GRANT_ACQUIRED'; identity: FinanceGrantIdentity; grant: FinanceAcquiredGrant }
	| { type: 'GRANT_AVAILABLE'; identity: FinanceGrantIdentity }
	| { type: 'GRANT_ISSUE'; identity: FinanceGrantIdentity; issue: FinanceGrantIssue }
	| { type: 'GRANT_REPLY_REJECTED'; identity: FinanceGrantIdentity; reply: FinanceGrantReply }
export type FinanceGrantOwnerOutput =
	| { kind: 'closed'; identity: FinanceGrantIdentity; receipt: WorkerHostClosed }
	| { kind: 'not-issued'; identity: FinanceGrantIdentity; reason: FinanceGrantRefusal['reason'] }
export type FinanceGrantOwnerInput = Readonly<{
	request: FinanceGrantRequest
	origin: string
	closeRequestId: string
	acquisitionTimeoutMs: number
	requestTimeoutMs: number
	closeTimeoutMs: number
	/** One selected synchronous native post. It neither awaits a grant nor starts actors. */
	postAcquire: (request: FinanceGrantRequest) => WorkerChannelPostReceipt
	reportTo: ActorRef<Snapshot<unknown>, FinanceGrantOwnerReport>
}>
export type FinanceGrantOwnerEvent =
	| { type: 'GRANT_REPLY'; reply: FinanceGrantReply }
	| { type: 'REQUEST'; call: BrokerHostCall }
	| { type: 'RETIRE' }
	| { type: 'CHANNEL_OVERDUE'; identity: WorkerHostClosed }
	| { type: 'CHANNEL_BLOCKED'; scope: string }
	| { type: 'CHANNEL_NATIVE_FAILED'; failure: WorkerHostCloseFailure }
