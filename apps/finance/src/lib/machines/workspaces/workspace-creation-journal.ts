import { createWorkspaceJournal } from 'delightful-local-first/workspace/journal'
import { z } from 'zod'
import { workspaceCreationAttemptSchema } from '../../validation/identity.js'

export const workspaceJournalRecordSchema = z.strictObject({
	key: z.string().min(1),
	attempt: workspaceCreationAttemptSchema
})
export type WorkspaceJournalRecord = z.infer<typeof workspaceJournalRecordSchema>
export type JournalResult =
	import('delightful-local-first/workspace/journal').WorkspaceJournalResult<WorkspaceJournalRecord>
export const workspaceCreationJournal = createWorkspaceJournal({
	databaseName: 'delightful-finances-workspace-attempts',
	attemptId: (record) => record.attempt.organizationId,
	schema: workspaceJournalRecordSchema
})
