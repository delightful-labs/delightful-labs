import { createWorkspacePersistence as createSharedPersistence } from 'delightful-local-first/workspace/creation-persistence'
import type { getDb } from 'jazz-tools/svelte'
import { workspaceCreationAttemptSchema } from '../../validation/identity.js'
import type { WorkspaceCreationAttempt } from '../../domain/workspace-creation.js'
import { workspaceCreationReconciliation } from './workspace-creation-reconciliation.js'

import { createAdditionalWorkspaceTransaction } from './workspace-additional-creation-transaction.js'
import type { SnapshotFrom } from 'xstate'

type Db = Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction'>

export function createWorkspacePersistence(db: Db) {
	const transaction = createAdditionalWorkspaceTransaction(db)
	return createSharedPersistence<
		Db,
		WorkspaceCreationAttempt,
		import('../../schema.js').Organization,
		SnapshotFrom<typeof workspaceCreationReconciliation>,
		SnapshotFrom<typeof transaction>
	>({
		db,
		validate: (attempt) => Promise.resolve(workspaceCreationAttemptSchema.parse(attempt)),
		reconcile: workspaceCreationReconciliation,
		transaction
	})
}
