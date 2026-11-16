import type { ActorRef, Snapshot } from 'xstate'
import type {
	BrokerHostResult,
	BrokerHostReply
} from 'delightful-local-first/backend/jazz/worker-broker'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import type {
	WorkerCallbackCustody,
	WorkerCallbackInterruption
} from 'delightful-local-first/worker/callback-custody'
import type { FinanceGrantIdentity } from '../../runtime/worker/grant-protocol.js'
import type { FinanceGrantOwnerEvent } from './worker-grant-contracts.js'
import type {
	FinancePreparedSdkCall,
	FinanceSdkCallbackIdentity
} from './worker-sdk-call-contracts.js'

export type FinanceSdkCallCustody = WorkerCallbackCustody<
	FinanceSdkCallbackIdentity,
	BrokerHostReply,
	WorkerCallbackInterruption
>
export type FinanceSdkCallReport =
	| {
			type: 'SDK_CALL_REQUIRES_FAULT'
			identity: FinanceSdkCallbackIdentity
			grant: FinanceGrantIdentity
	  }
	| {
			type: 'SDK_CALL_DELIVERED'
			identity: FinanceSdkCallbackIdentity
			grant: FinanceGrantIdentity
			reservation: 'releasable' | 'retained-until-close'
	  }
	| { type: 'SDK_CALL_BLOCKED'; identity: FinanceSdkCallbackIdentity; grant: FinanceGrantIdentity }
export type FinanceSdkCallOutput = Readonly<{
	kind: 'released'
	identity: FinanceSdkCallbackIdentity
	grant: FinanceGrantIdentity
	evidence: 'definitive-result' | 'grant-closed'
}>
export type FinanceSdkCallOwnerInput = Readonly<{
	prepared: FinancePreparedSdkCall
	grant: FinanceGrantIdentity
	closeRequestId: string
	grantTo: ActorRef<Snapshot<unknown>, FinanceGrantOwnerEvent>
	reportTo: ActorRef<Snapshot<unknown>, FinanceSdkCallReport>
	/** The root already retains this registration before offering the callback.
	 * The same root retains custody through child error and forced stop. */
	custody: Pick<FinanceSdkCallCustody, 'recordStopResult' | 'deliver'>
}>
export type FinanceSdkCallOwnerEvent =
	/** Actual native SDK recipient observation after resolve/reject returned.
	 * Neither keeper delivery's void return nor a stopped observer supplies this fact. */
	| { type: 'SDK_CALLBACK_SETTLED'; identity: FinanceSdkCallbackIdentity }
	| { type: 'GRANT_AVAILABLE'; identity: FinanceGrantIdentity }
	| {
			type: 'BROKER_RESULT'
			identity: FinanceSdkCallbackIdentity
			result: BrokerHostResult
			token: object | undefined
	  }
	/** Sent only after the population entered its faulted admission state. */
	| { type: 'ADMISSION_FAULTED'; identity: FinanceSdkCallbackIdentity }
	| {
			/** The population already closed admission (fault or actual SDK closure).
			 * This command never abandons an issued call. */
			type: 'CANCEL_WAITING'
			identity: FinanceSdkCallbackIdentity
			reason: 'closed' | 'unavailable'
	  }
	| { type: 'GRANT_CLOSED'; identity: FinanceGrantIdentity; receipt: WorkerHostClosed }
