import { createWorkspaceCreationOperation as createSharedOperation } from 'delightful-local-first/workspace/creation-operation'
import type { getDb } from 'jazz-tools/svelte'
import type { Organization } from '../../schema.js'
import { workspaceNameFormSchema } from '../../validation/identity.js'
import { prepareWorkspaceCreation } from '../../domain/workspace-creation.js'
import {
	workspaceCreationJournal,
	type WorkspaceJournalRecord
} from './workspace-creation-journal.js'
import { workspaceCreationReconciliation } from './workspace-creation-reconciliation.js'
import { createWorkspacePersistence } from './workspace-creation-persistence.js'
import type { WorkspacePersistenceResult } from './workspace-creation-transaction.js'
import type { SnapshotFrom } from 'xstate'

export type CreationBinding = { key: string; userId: string; profileId: string }
export type CreationRequest =
	| { mode: 'load' }
	| { mode: 'create'; name: string }
	| { mode: 'clear'; record: WorkspaceJournalRecord }
	| { mode: 'retry'; record: WorkspaceJournalRecord; settlement: 'notStarted' | 'unresolved' }
export type CreationResult =
	| { outcome: 'editing' | 'invalid'; record: undefined; settlement: 'notStarted' }
	| { outcome: 'recovered'; record: WorkspaceJournalRecord; settlement: 'notStarted' }
	| {
			outcome: 'complete'
			record: WorkspaceJournalRecord
			workspace: Organization
			settlement: 'locallyPersisted'
	  }
	| { outcome: 'conflict'; record: WorkspaceJournalRecord | undefined; settlement: 'notStarted' }
	| {
			outcome: 'failed'
			record: WorkspaceJournalRecord | undefined
			settlement: 'notStarted'
			error: unknown
	  }
	| {
			outcome: 'unresolved'
			record: WorkspaceJournalRecord | undefined
			settlement: 'unresolved'
			error: unknown
	  }
	| {
			outcome: 'cancelled' | 'closed'
			record: WorkspaceJournalRecord | undefined
			settlement: WorkspacePersistenceResult['settlement']
	  }

type Db = Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction'>
export function createWorkspaceCreationOperation(db: Db) {
	const persist = createWorkspacePersistence(db)
	return createSharedOperation<
		Db,
		Organization,
		WorkspaceJournalRecord,
		SnapshotFrom<typeof workspaceCreationJournal>,
		SnapshotFrom<typeof workspaceCreationReconciliation>,
		SnapshotFrom<typeof persist>,
		CreationBinding
	>({
		db,
		validate: (name) => Promise.resolve(workspaceNameFormSchema.parse({ name }).name),
		prepare: async ({ binding, name }) => ({
			key: binding.key,
			attempt: await prepareWorkspaceCreation({
				organizationId: crypto.randomUUID(),
				userId: binding.userId,
				profileId: binding.profileId,
				name
			})
		}),
		journal: workspaceCreationJournal,
		reconcile: workspaceCreationReconciliation,
		persist,
		matchesBinding: (record, binding) =>
			record.key === binding.key &&
			record.attempt.profileId === binding.profileId &&
			record.attempt.workspace.ownerId === binding.userId,
		attemptId: (record) => record.attempt.organizationId
	})
}
