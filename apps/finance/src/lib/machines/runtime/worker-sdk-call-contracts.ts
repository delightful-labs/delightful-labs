import type {
	BrokerHostCall,
	BrokerHostReply
} from 'delightful-local-first/backend/jazz/worker-broker'
import type {
	WorkerCallbackInterruption,
	WorkerCallbackResult,
	WorkerCallbackStopResult
} from 'delightful-local-first/worker/callback-custody'
import type { FinanceGrantDescriptor } from '../../runtime/worker/grant-binding.js'

/** Private callback correlation, independent of a grant's wire sequence. */
export type FinanceSdkCallbackIdentity = Readonly<{ runtimeId: string; requestId: string }>
export type FinanceSdkCallbackResult = WorkerCallbackResult<
	BrokerHostReply,
	WorkerCallbackInterruption
>
export type FinanceSdkCallbackStopResult = WorkerCallbackStopResult<
	BrokerHostReply,
	WorkerCallbackInterruption
>
export type FinancePreparedSdkCall = Readonly<{
	identity: FinanceSdkCallbackIdentity
	descriptor: FinanceGrantDescriptor
	call: BrokerHostCall
	/** UTF-8 JSON operation payload only; the population owns aggregate admission. */
	payloadBytes: number
}>
