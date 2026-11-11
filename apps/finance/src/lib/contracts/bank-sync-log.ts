import type { z } from 'zod'
import type {
	syncAttemptSchema,
	syncAccountCompletionSchema
} from '#lib/validation/bank-sync-log.js'

type AttemptValues = z.output<typeof syncAttemptSchema>
export type SyncLogStart = Pick<
	AttemptValues,
	'organizationId' | 'connectionId' | 'initiatedBy' | 'startedAt'
> & { id: string }
export type SyncLogCompletion = Omit<AttemptValues, keyof SyncLogStart | 'outcome'> & {
	outcome: Exclude<AttemptValues['outcome'], 'unfinished'>
	finishedAt: Date
}
export type SyncLogAccountResult = Omit<
	z.output<typeof syncAccountCompletionSchema>,
	'attemptId' | 'organizationId'
>
export type SyncLogEvent =
	| { type: 'CANCEL' }
	| { type: 'FINISH'; result: SyncLogCompletion; accounts?: readonly SyncLogAccountResult[] }
export type SyncLogOutput =
	| { kind: 'notStarted'; attemptId: string; reason: 'invalidStart' | 'startWriteFailed' }
	| { kind: 'recorded'; attemptId: string; result: SyncLogCompletion }
	| {
			kind: 'resultUnrecorded'
			attemptId: string
			result: SyncLogCompletion
			reason: 'invalidResult' | 'resultWriteFailed' | 'accountWriteFailed'
	  }
export type SyncLogParentEvent = { type: 'SYNC_LOG_READY'; attemptId: string }
