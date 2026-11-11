import { schema as s } from 'jazz-tools'
import {
	syncCount,
	syncFailureCode,
	syncOutcome,
	syncSettlement
} from '../validation/bank-sync-log.js'

const outcome = () =>
	s.enum(
		syncOutcome.enum.unfinished,
		syncOutcome.enum.succeeded,
		syncOutcome.enum.partial,
		syncOutcome.enum.failed,
		syncOutcome.enum.cancelled
	)
const failureCode = () =>
	s
		.enum(
			syncFailureCode.enum.authorization,
			syncFailureCode.enum.passkey,
			syncFailureCode.enum.provider,
			syncFailureCode.enum.mapping,
			syncFailureCode.enum.import,
			syncFailureCode.enum.interrupted,
			syncFailureCode.enum.unexpected
		)
		.optional()
const count = () =>
	s
		.int()
		.optional()
		.transform<number | null>({
			from: (value) => syncCount.nullable().parse(value),
			to: (value) => syncCount.nullable().parse(value)
		})
const counts = () => ({ importedCount: count(), existingCount: count(), omittedCount: count() })

export const bankSyncLogSchema = {
	simplefinSyncAttempts: s.table(
		{
			organizationId: s.uuid(),
			connectionId: s.uuid(),
			initiatedBy: s.uuid(),
			startedAt: s.timestamp(),
			finishedAt: s.timestamp().optional(),
			outcome: outcome(),
			importSettlement: s.enum(
				syncSettlement.enum.notStarted,
				syncSettlement.enum.locallyPersisted,
				syncSettlement.enum.confirmed,
				syncSettlement.enum.unresolved
			),
			failureCode: failureCode(),
			...counts()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			connection: s.rel('simplefinConnections', 'connectionId')
		}
	),
	simplefinSyncAccountResults: s.table(
		{
			attemptId: s.uuid(),
			organizationId: s.uuid(),
			accountId: s.uuid(),
			accountName: s.string(),
			outcome: outcome(),
			failureCode: failureCode(),
			...counts()
		},
		{
			attempt: s.rel('simplefinSyncAttempts', 'attemptId'),
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	)
}
