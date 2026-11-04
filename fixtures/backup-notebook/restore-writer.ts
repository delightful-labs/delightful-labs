import {
	PersistedWriteRejectedError,
	type Db,
	type Transaction,
	type WriteHandle
} from 'jazz-tools'
import { assign, fromPromise, setup } from 'xstate'
import type { RestoreJournalIntent } from 'delightful-local-first/backup/restore/journal'
import {
	restoreTransactionAccess,
	type RestoreTransactionWriter,
	type RestoreDestinationInput,
	type RestoreDestinationResult,
	type RestoreEvent
} from 'delightful-local-first/backup/restore'
import { sameBackupBinding } from 'delightful-local-first/backup/export'
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

/** Finite destination operation; the shared write actor owns transaction custody and settlement. */
export function createNotebookPreparationWriter(db: Db) {
	type Input = RestoreDestinationInput<Transaction<'mergeable'>>
	type Context = {
		input: Input
		result: RestoreDestinationResult
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	}
	const query = (input: Input) =>
		notebookRestoreApp.restoreDestinations.where({
			id: input.intent.operation.destinationWorkspaceId
		})
	// Return only a bounded comparison fact; SDK rows never enter actor snapshots.
	const matches = (
		row: import('jazz-tools').schema.RowOf<typeof notebookRestoreApp.restoreDestinations> | null,
		input: Input
	) => {
		if (!row) return { present: false, matches: false }
		const expected = notebookPreparationContents(input.intent)
		return {
			present: true,
			matches:
				row.id === input.intent.operation.destinationWorkspaceId &&
				row.ownerId === expected.ownerId &&
				row.operationId === expected.operationId &&
				row.payloadSha256 === expected.payloadSha256 &&
				row.graphSha256 === expected.graphSha256 &&
				row.status === expected.status
		}
	}
	const actors = {
		remote: fromPromise(({ input }: { input: Input }) =>
			db.one(query(input), { tier: 'remote' }).then((row) => matches(row, input))
		),
		read: fromPromise(({ input }: { input: Input }) =>
			restoreTransactionAccess(input).call((tx) =>
				tx.one(query(input)).then((row) => matches(row, input))
			)
		),
		identity: fromPromise(({ input }: { input: Input }) =>
			Promise.resolve(db.getAuthState().session?.user.account === input.intent.operation.identityId)
		),
		stage: fromPromise<void, Input>(({ input }) =>
			restoreTransactionAccess(input).call((tx) => {
				if (db.getAuthState().session?.user.account !== input.intent.operation.identityId)
					throw new Error('Restore identity changed')
				tx.insert(
					notebookRestoreApp.restoreDestinations,
					notebookPreparationContents(input.intent),
					{ id: input.intent.operation.destinationWorkspaceId }
				)
			})
		)
	}
	const model = setup<
		Context,
		RestoreEvent,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		RestoreDestinationResult
	>({ actors })
	const input = ({ context }: { context: Context }) => context.input
	return model.createMachine({
		id: 'notebook-preparation-destination',
		initial: 'admitting',
		context: ({ input }) => ({ input, result: 'unavailable', interruption: undefined }),
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: { actions: assign({ interruption: 'cancelled' }) },
			SHUTDOWN: { actions: assign({ interruption: 'closed' }) },
			INVALIDATE: {
				guard: ({ context, event }) => sameBackupBinding(context.input.binding, event.binding),
				actions: assign({ interruption: 'invalidated' })
			}
		},
		states: {
			admitting: {
				always: [
					{
						guard: ({ context }) =>
							context.input.step.writeId !== context.input.intent.plan.preparation.writeId,
						target: 'conflict'
					},
					{ guard: ({ context }) => context.input.operation === 'remote', target: 'remote' },
					{ guard: ({ context }) => context.input.operation === 'read', target: 'read' },
					{ target: 'identity' }
				]
			},
			remote: {
				invoke: {
					src: 'remote',
					input,
					onDone: [
						{ guard: ({ context }) => context.interruption !== undefined, target: 'complete' },
						{ guard: ({ event }) => !event.output.present, target: 'missing' },
						{ guard: ({ event }) => event.output.matches, target: 'match' },
						{ target: 'conflict' }
					],
					onError: 'complete'
				}
			},
			read: {
				invoke: {
					src: 'read',
					input,
					onDone: [
						{ guard: ({ context }) => context.interruption !== undefined, target: 'complete' },
						{ guard: ({ event }) => !event.output.present, target: 'missing' },
						{ guard: ({ event }) => event.output.matches, target: 'match' },
						{ target: 'conflict' }
					],
					onError: 'complete'
				}
			},
			identity: {
				invoke: {
					src: 'identity',
					input,
					onDone: [
						{ guard: ({ context }) => context.interruption !== undefined, target: 'complete' },
						{ guard: ({ event }) => !event.output, target: 'denied' },
						{ guard: ({ context }) => context.input.operation === 'stage', target: 'stage' },
						{ target: 'allowed' }
					],
					onError: 'complete'
				}
			},
			stage: {
				invoke: {
					src: 'stage',
					input,
					onDone: [
						{ guard: ({ context }) => context.interruption !== undefined, target: 'complete' },
						{ target: 'staged' }
					],
					onError: 'complete'
				}
			},
			match: { type: 'final', entry: assign({ result: 'match' }) },
			missing: { type: 'final', entry: assign({ result: 'missingOrHidden' }) },
			conflict: { type: 'final', entry: assign({ result: 'conflict' }) },
			denied: { type: 'final', entry: assign({ result: 'denied' }) },
			allowed: { type: 'final', entry: assign({ result: 'allowed' }) },
			staged: { type: 'final', entry: assign({ result: 'staged' }) },
			complete: { type: 'final' }
		}
	})
}

/** Native transaction operations shared by destination statecharts; no domain decisions. */
export function createNotebookTransactionWriter(
	db: Db,
	retainDetached: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
) {
	return {
		open: () => db.beginTransaction(),
		commit: (transaction) => transaction.commit(),
		transactionId: (write) => write.txId,
		persistLocal: (write) => write.wait({ tier: 'local' }),
		acceptRemote: (write) => write.wait({ tier: 'global' }),
		isRemoteRejection: (error, transactionId) =>
			error instanceof PersistedWriteRejectedError && error.transactionId === transactionId,
		rollback: (transaction) => transaction.rollback(),
		retainDetached
	} satisfies RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>
}
