import {
	PersistedWriteRejectedError,
	type Db,
	type Transaction,
	type WriteHandle
} from 'jazz-tools'
import { and, assign, fromCallback, fromPromise, not, raise, setup, stateIn } from 'xstate'
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

type DestinationInput = RestoreDestinationInput<Transaction<'mergeable'>>
type DestinationWriteResult = Extract<
	RestoreDestinationResult,
	'allowed' | 'denied' | 'staged' | 'unavailable' | 'cancelled' | 'closed' | 'invalidated'
>
type IdentityReport =
	| {
			type: 'IDENTITY_OBSERVED'
			binding: DestinationInput['binding']
			identityId: string | undefined
	  }
	| { type: 'IDENTITY_FAILED'; binding: DestinationInput['binding'] }

/** Owns identity admission and staging; its caller retains the borrowed transaction's lifetime. */
export function createNotebookDestinationWriteMachine(
	db: Db,
	insert: (transaction: Transaction<'mergeable'>, input: DestinationInput) => void
) {
	type Context = {
		input: DestinationInput
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: DestinationWriteResult
	}
	const actors = {
		// Native subscription bridge only. All admission and draining decisions live below.
		observeIdentity: fromCallback<RestoreEvent, DestinationInput>(({ input, sendBack }) => {
			try {
				return db.onAuthChanged((state) =>
					sendBack({
						type: 'IDENTITY_OBSERVED',
						binding: input.binding,
						identityId: state.session?.user.account ?? undefined
					} satisfies IdentityReport)
				)
			} catch {
				sendBack({ type: 'IDENTITY_FAILED', binding: input.binding } satisfies IdentityReport)
			}
		}),
		insert: fromPromise<'inserted' | 'identityMismatch', DestinationInput>(({ input }) =>
			restoreTransactionAccess(input).call((transaction) => {
				// Synchronous invariant at the SDK write boundary, after machine-owned admission.
				if (db.getAuthState().session?.user.account !== input.intent.operation.identityId)
					return 'identityMismatch'
				insert(transaction, input)
				return 'inserted'
			})
		)
	}
	const model = setup<
		Context,
		RestoreEvent | IdentityReport,
		typeof actors,
		{},
		{ interrupt: undefined },
		{
			interrupted: undefined
			currentBinding: undefined
			currentReport: undefined
			identityMatches: undefined
			stageOperation: undefined
			writeOperation: undefined
			revoked: undefined
			observationFailed: undefined
		},
		never,
		string,
		DestinationInput,
		DestinationWriteResult
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.input.binding, event.binding),
			currentReport: ({ context, event }) =>
				(event.type === 'IDENTITY_OBSERVED' || event.type === 'IDENTITY_FAILED') &&
				sameBackupBinding(context.input.binding, event.binding),
			identityMatches: ({ context, event }) =>
				event.type === 'IDENTITY_OBSERVED' &&
				event.identityId === context.input.intent.operation.identityId,
			stageOperation: ({ context }) => context.input.operation === 'stage',
			writeOperation: ({ context }) =>
				context.input.operation === 'authority' || context.input.operation === 'stage',
			revoked: stateIn('#notebook-write-revoked'),
			observationFailed: stateIn('#notebook-write-observation-failed')
		},
		actions: {
			interrupt: assign({
				interruption: ({ context, event }) =>
					context.interruption ??
					(event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled')
			})
		}
	})
	const input = ({ context }: { context: Context }) => context.input
	return model.createMachine({
		id: 'notebook-destination-write',
		initial: 'working',
		context: ({ input }) => ({ input, interruption: undefined, result: 'unavailable' }),
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: { guard: 'currentBinding', actions: 'interrupt' }
		},
		states: {
			working: {
				initial: 'observingIdentity',
				invoke: {
					src: 'observeIdentity',
					input,
					onError: {
						actions: raise(({ context }) => ({
							type: 'IDENTITY_FAILED',
							binding: context.input.binding
						}))
					}
				},
				states: {
					observingIdentity: {
						always: [
							{ guard: 'interrupted', target: '#notebook-destination-write.complete' },
							{ guard: not('writeOperation'), target: '#notebook-destination-write.unavailable' }
						],
						on: {
							IDENTITY_OBSERVED: [
								{
									guard: and(['currentReport', not('identityMatches')]),
									target: '#notebook-destination-write.denied'
								},
								{
									guard: and(['currentReport', 'identityMatches', 'stageOperation']),
									target: 'inserting'
								},
								{
									guard: and(['currentReport', 'identityMatches']),
									target: '#notebook-destination-write.allowed'
								}
							],
							IDENTITY_FAILED: {
								guard: 'currentReport',
								target: '#notebook-destination-write.unavailable'
							}
						}
					},
					inserting: {
						initial: 'pending',
						invoke: {
							src: 'insert',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#notebook-destination-write.complete' },
								{ guard: 'revoked', target: '#notebook-destination-write.denied' },
								{ guard: 'observationFailed', target: '#notebook-destination-write.unavailable' },
								{
									guard: ({ event }) => event.output === 'identityMismatch',
									target: '#notebook-destination-write.denied'
								},
								{ target: '#notebook-destination-write.staged' }
							],
							onError: '#notebook-destination-write.unavailable'
						},
						states: {
							pending: {
								on: {
									IDENTITY_OBSERVED: [
										{ guard: and(['currentReport', 'identityMatches']) },
										{ guard: 'currentReport', target: 'revoked' }
									],
									IDENTITY_FAILED: { guard: 'currentReport', target: 'observationFailed' }
								}
							},
							revoked: { id: 'notebook-write-revoked' },
							observationFailed: { id: 'notebook-write-observation-failed' }
						}
					}
				}
			},
			allowed: { type: 'final', entry: assign({ result: 'allowed' }) },
			denied: { type: 'final', entry: assign({ result: 'denied' }) },
			staged: { type: 'final', entry: assign({ result: 'staged' }) },
			unavailable: { type: 'final' },
			complete: { type: 'final' }
		}
	})
}

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

export function createNotebookPreparationWriteMachine(db: Db) {
	return createNotebookDestinationWriteMachine(db, (transaction, input) => {
		transaction.insert(
			notebookRestoreApp.restoreDestinations,
			notebookPreparationContents(input.intent),
			{ id: input.intent.operation.destinationWorkspaceId }
		)
	})
}

/** Finite destination operation; the shared write actor owns transaction custody and settlement. */
export function createNotebookPreparationWriter(
	db: Db,
	write = createNotebookPreparationWriteMachine(db)
) {
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
		write
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
	const forward = model.enqueueActions(({ self, event, enqueue }) => {
		const child = self.getSnapshot().children.write
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, event)
	})
	const input = ({ context }: { context: Context }) => context.input
	return model.createMachine({
		id: 'notebook-preparation-destination',
		initial: 'admitting',
		context: ({ input }) => ({ input, result: 'unavailable', interruption: undefined }),
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: {
				actions: [
					assign({ interruption: ({ context }) => context.interruption ?? 'cancelled' }),
					forward
				]
			},
			SHUTDOWN: {
				actions: [
					assign({ interruption: ({ context }) => context.interruption ?? 'closed' }),
					forward
				]
			},
			INVALIDATE: {
				guard: ({ context, event }) => sameBackupBinding(context.input.binding, event.binding),
				actions: [
					assign({ interruption: ({ context }) => context.interruption ?? 'invalidated' }),
					forward
				]
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
					{ target: 'writing' }
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
			writing: {
				invoke: {
					id: 'write',
					src: 'write',
					input,
					onDone: {
						target: 'complete',
						actions: assign({ result: ({ event }) => event.output })
					},
					onError: 'complete'
				}
			},
			match: { type: 'final', entry: assign({ result: 'match' }) },
			missing: { type: 'final', entry: assign({ result: 'missingOrHidden' }) },
			conflict: { type: 'final', entry: assign({ result: 'conflict' }) },
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
