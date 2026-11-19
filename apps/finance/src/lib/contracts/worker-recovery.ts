import type { RestorationScope } from 'delightful-local-first/restoration/contracts'
import type { RecoveryResult } from 'delightful-local-first/recovery/coordination'
import type { FinanceWorkerSession } from './worker-application.js'

/** Only non-secret terminal facts leave the private recovery coordinator. */
export type FinanceRecoveryFinished = {
	type: 'RESTORATION_FINISHED'
	scope: RestorationScope
	result: RecoveryResult
	view: ReturnType<FinanceWorkerSession['view']['get']>
}
