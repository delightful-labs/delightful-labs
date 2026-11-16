import type {
	BrokerHostCall,
	BrokerHostReply
} from 'delightful-local-first/backend/jazz/worker-broker'
import type {
	WorkerCallbackInterruption,
	WorkerCallbackResult
} from 'delightful-local-first/worker/callback-custody'
import type { FinanceGrantDescriptor } from '../../runtime/worker/grant-binding.js'

/** Private callback correlation, independent of a grant's wire sequence. */
export type FinanceSdkCallbackIdentity = Readonly<{ runtimeId: string; requestId: string }>
export type FinanceSdkCallbackResult = WorkerCallbackResult<
	BrokerHostReply,
	WorkerCallbackInterruption
>
/** Internal, immutable capture returned by prepareFinanceSdkCall, never a wire DTO.
 * Admission and the child consume the same snapshot; do not assemble it separately. */
export type FinancePreparedSdkCall = Readonly<{
	identity: FinanceSdkCallbackIdentity
	descriptor: Readonly<FinanceGrantDescriptor>
	call: Omit<BrokerHostCall, 'request'> & Readonly<{ request: Readonly<BrokerHostCall['request']> }>
	/** UTF-8 JSON operation payload only; the population owns aggregate admission. */
	payloadBytes: number
}>
