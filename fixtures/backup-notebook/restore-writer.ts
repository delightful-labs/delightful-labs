import {
	PersistedWriteRejectedError,
	type Db,
	type Transaction,
	type WriteHandle
} from 'jazz-tools'
import type { RestoreJournalIntent } from 'delightful-local-first/backup/restore/journal'
import type {
	RestorePreparationWriter,
	PreparationPresence
} from 'delightful-local-first/backup/restore/preparation'
import { notebookRestoreApp } from './restore-schema.js'

export function notebookPreparationContents(intent: RestoreJournalIntent) {
	return {
		ownerId: intent.operation.identityId,
		operationId: intent.operation.operationId,
		payloadSha256: intent.archive.payloadSha256,
		// Bind graph content without a circular dependency on the preparation digest.
		graphSha256: intent.plan.expectedGraphSha256,
		status: 'incomplete'
	} satisfies import('jazz-tools').schema.InsertOf<typeof notebookRestoreApp.restoreDestinations>
}

type Row = import('jazz-tools').schema.RowOf<typeof notebookRestoreApp.restoreDestinations>
function presence(row: Row | null, intent: RestoreJournalIntent): PreparationPresence {
	if (!row) return 'missingOrHidden'
	const expected = notebookPreparationContents(intent)
	return row.id === intent.operation.destinationWorkspaceId &&
		row.ownerId === expected.ownerId &&
		row.operationId === expected.operationId &&
		row.payloadSha256 === expected.payloadSha256 &&
		row.graphSha256 === expected.graphSha256 &&
		row.status === expected.status
		? 'match'
		: 'conflict'
}

/** Session lifetime and detached native transaction custody remain host-owned. */
export function createNotebookPreparationWriter(
	db: Db,
	retainDetached: RestorePreparationWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
): RestorePreparationWriter<Transaction<'mergeable'>, WriteHandle> {
	return {
		readRemote: (intent) =>
			db
				.one(
					notebookRestoreApp.restoreDestinations.where({
						id: intent.operation.destinationWorkspaceId
					}),
					{ tier: 'remote' }
				)
				.then((row) => presence(row, intent)),
		// Admission for the first owner-bound insert, not a server-acceptance observation.
		// Persistent-browser permission advice is unknown; the server enforces the insert policy.
		checkAuthority: (intent) =>
			Promise.resolve(db.getAuthState().session?.user.account === intent.operation.identityId),
		open: () => db.beginTransaction(),
		readTransaction: (transaction, intent) =>
			transaction
				.one(
					notebookRestoreApp.restoreDestinations.where({
						id: intent.operation.destinationWorkspaceId
					})
				)
				.then((row) => presence(row, intent)),
		stage(transaction, intent) {
			// Atomic invariant at the write boundary; workflow eligibility is decided by the actor.
			if (db.getAuthState().session?.user.account !== intent.operation.identityId)
				throw new Error('Restore identity changed')
			transaction.insert(
				notebookRestoreApp.restoreDestinations,
				notebookPreparationContents(intent),
				{ id: intent.operation.destinationWorkspaceId }
			)
		},
		commit: (transaction) => transaction.commit(),
		transactionId: (write) => write.txId,
		persistLocal: (write) => write.wait({ tier: 'local' }),
		acceptRemote: (write) => write.wait({ tier: 'global' }),
		isRemoteRejection: (error, transactionId) =>
			error instanceof PersistedWriteRejectedError && error.transactionId === transactionId,
		rollback: (transaction) => transaction.rollback(),
		retainDetached
	}
}
