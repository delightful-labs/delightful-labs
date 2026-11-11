import { z } from 'zod'

export const syncOutcome = z.enum(['unfinished', 'succeeded', 'partial', 'failed', 'cancelled'])
export const syncSettlement = z.enum(['notStarted', 'locallyPersisted', 'confirmed', 'unresolved'])
export const syncFailureCode = z.enum([
	'authorization',
	'passkey',
	'provider',
	'mapping',
	'import',
	'interrupted',
	'unexpected'
])
export const syncCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const counts = {
	importedCount: syncCount.nullable(),
	existingCount: syncCount.nullable(),
	omittedCount: syncCount.nullable()
}
export const syncAttemptSchema = z
	.strictObject({
		organizationId: z.uuid(),
		connectionId: z.uuid(),
		initiatedBy: z.uuid(),
		startedAt: z.date(),
		finishedAt: z.date().nullable(),
		outcome: syncOutcome,
		importSettlement: syncSettlement,
		failureCode: syncFailureCode.nullable(),
		...counts
	})
	.superRefine((attempt, context) => {
		if ((attempt.outcome === 'unfinished') !== (attempt.finishedAt === null)) {
			context.addIssue({
				code: 'custom',
				path: ['finishedAt'],
				message: 'Outcome and finish time disagree'
			})
		}
		if (attempt.finishedAt && attempt.finishedAt < attempt.startedAt) {
			context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'Finish precedes start' })
		}
	})
export const syncAccountResultSchema = z.strictObject({
	attemptId: z.uuid(),
	organizationId: z.uuid(),
	accountId: z.uuid(),
	accountName: z.string().min(1),
	outcome: syncOutcome,
	failureCode: syncFailureCode.nullable(),
	...counts
})
export const syncAccountCompletionSchema = syncAccountResultSchema.extend({
	outcome: syncOutcome.exclude(['unfinished'])
})
