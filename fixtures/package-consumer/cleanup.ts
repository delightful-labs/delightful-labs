// Compile-only example: a notebook host without Finance attempt or provenance fields.
import { z } from 'zod'
import type { Snapshot, SnapshotFrom } from 'xstate'
import { createWorkspaceJournal } from 'delightful-local-first/workspace/journal'
import {
	createWorkspaceCreationOperation,
	type CreationChild,
	type CreationPersistenceResult,
	type CreationReconciliation,
	type ReconciliationLogic
} from 'delightful-local-first/workspace/creation-operation'
import { createWorkspacePersistence } from 'delightful-local-first/workspace/creation-persistence'
import { createWorkspaceCreationOwner } from 'delightful-local-first/workspace/creation-owner'

const recordSchema = z.object({
	key: z.string(),
	attempt: z.object({ notebookId: z.string(), memberId: z.string(), title: z.string() })
})
type Record = z.output<typeof recordSchema>
type Binding = { key: string; memberId: string }
type Workspace = { notebookId: string }

export function notebookCreation(
	db: object,
	reconcile: ReconciliationLogic<
		Snapshot<CreationReconciliation<Workspace>>,
		{ db: object; attempt: Record['attempt'] }
	>,
	transaction: CreationChild<
		Snapshot<CreationPersistenceResult<Workspace>>,
		{ attempt: Record['attempt'] }
	>
) {
	const journal = createWorkspaceJournal({
		databaseName: 'notebook-creation',
		schema: recordSchema,
		attemptId: (record) => record.attempt.notebookId
	})
	const persist = createWorkspacePersistence<
		object,
		Record['attempt'],
		Workspace,
		Snapshot<CreationReconciliation<Workspace>>,
		Snapshot<CreationPersistenceResult<Workspace>>
	>({
		db,
		validate: (attempt: Record['attempt']) =>
			Promise.resolve(recordSchema.shape.attempt.parse(attempt)),
		reconcile,
		transaction
	})
	const operation = createWorkspaceCreationOperation<
		object,
		Workspace,
		Record,
		SnapshotFrom<typeof journal>,
		Snapshot<CreationReconciliation<Workspace>>,
		SnapshotFrom<typeof persist>,
		Binding
	>({
		db,
		journal,
		reconcile,
		persist,
		validate: (name) => Promise.resolve(name.trim()),
		prepare: ({ binding, name }) =>
			Promise.resolve({
				key: binding.key,
				attempt: { notebookId: crypto.randomUUID(), memberId: binding.memberId, title: name }
			}),
		matchesBinding: (record, binding) => record.attempt.memberId === binding.memberId,
		attemptId: (record) => record.attempt.notebookId
	})
	return createWorkspaceCreationOwner<Record, Workspace, SnapshotFrom<typeof operation>, Binding>(
		operation
	)
}
