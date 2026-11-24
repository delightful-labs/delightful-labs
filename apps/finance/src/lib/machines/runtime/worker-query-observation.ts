import { createBoundObservationLogic } from 'delightful-local-first/data/observation-workflow'
import type { SessionRuntimeObservation } from 'delightful-local-first/session/runtime'
import type { FinanceWorkerCapabilities } from '../../contracts/worker-application.js'

export type FinanceWorkerReady = Extract<
	SessionRuntimeObservation<FinanceWorkerCapabilities>,
	{ status: 'ready' }
>

/** Finance's typed report binding; DLF owns the native observation lifetime. */
export function observeFinanceQuery<Result>(
	event:
		| 'BANK_CONNECTIONS'
		| 'BANK_LINKS'
		| 'TRANSFERS'
		| 'WORKSPACE_MEMBERS'
		| 'ACCOUNT_GRANTS'
		| 'PROFILE'
		| 'WORKSPACE'
		| 'WORKSPACES'
		| 'ACCOUNTS'
		| 'MEMBERSHIP'
		| 'GRANTS'
		| 'CATEGORIES'
		| 'TAGS'
		| 'TRANSACTIONS'
		| 'TRANSACTION'
) {
	return createBoundObservationLogic<
		Result,
		{
			binding: object
			observe: ((publish: (result: Result) => void, failed: () => void) => () => void) | undefined
			reportDisposalFailure: () => void
		},
		{ type: typeof event; binding: object; rows: Result } | { type: 'READ_FAILED'; binding: object }
	>({
		observe: (input, publish, failed) => input.observe?.(publish, failed),
		observed: (input, rows) => ({ type: event, binding: input.binding, rows }),
		failed: (input) => ({ type: 'READ_FAILED', binding: input.binding }),
		disposalFailed: (input) => input.reportDisposalFailure()
	})
}
