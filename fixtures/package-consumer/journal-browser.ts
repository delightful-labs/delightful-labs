import { z } from 'zod'
import { createWorkspaceJournal } from 'delightful-local-first/workspace/journal'
export { createActor, toPromise } from 'xstate'
export function createNotebookJournal(databaseName: string) {
	return createWorkspaceJournal({
		databaseName,
		schema: z.strictObject({
			key: z.string(),
			attempt: z.strictObject({ notebookId: z.string(), title: z.string() })
		}),
		attemptId: (record) => record.attempt.notebookId
	})
}
