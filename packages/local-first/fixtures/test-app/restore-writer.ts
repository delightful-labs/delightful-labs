import type { EventPayload } from './restore-events.js'
import {
	PersistedWriteRejectedError,
	type Db,
	type Transaction,
	type WriteHandle
} from 'jazz-tools'
import { createCallbackLogic, setup, matchesState, createAsyncLogic, types } from 'xstate'
import type { RestoreJournalIntent } from 'delightful-local-first/backup/restore/journal'
import {
	restoreTransactionAccess,
	type RestoreTransactionWriter,
	type RestoreDestinationInput,
	type RestoreDestinationResult,
	type RestoreEvent
} from 'delightful-local-first/backup/restore'
import { sameBackupBinding } from 'delightful-local-first/backup/binding'
import { testAppRestoreApp } from './restore-schema.js'

type IdentitySource = Pick<Db, 'getAuthState' | 'onAuthChanged'>

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
export function createTestAppDestinationWriteMachine(
	db: IdentitySource,
	insert: (transaction: Transaction<'mergeable'>, input: DestinationInput) => void
) {
	type Context = {
		input: DestinationInput
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: DestinationWriteResult
	}
	const actors = {
		// Native subscription bridge only. All admission and draining decisions live below.
		observeIdentity: createCallbackLogic<RestoreEvent, DestinationInput>(({ input, sendBack }) => {
			try {
				return db.onAuthChanged((state) =>
					sendBack({
						type: 'IDENTITY_OBSERVED',
						binding: input.binding,
						identityId: state.session?.user ?? undefined
					} satisfies IdentityReport)
				)
			} catch {
				sendBack({ type: 'IDENTITY_FAILED', binding: input.binding } satisfies IdentityReport)
			}
		}),
		insert: createAsyncLogic<'inserted' | 'identityMismatch', DestinationInput>({
			run: ({ input }) =>
				restoreTransactionAccess(input).call((transaction) => {
					// Synchronous invariant at the SDK write boundary, after machine-owned admission.
					if (db.getAuthState().session?.user !== input.intent.operation.identityId)
						return 'identityMismatch'
					insert(transaction, input)
					return 'inserted'
				})
		})
	}
	const model = setup({
		schemas: {
			output: types<DestinationWriteResult>(),
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<RestoreEvent | IdentityReport, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<RestoreEvent | IdentityReport, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<RestoreEvent | IdentityReport, 'INVALIDATE'>>(),
				IDENTITY_OBSERVED:
					types<EventPayload<RestoreEvent | IdentityReport, 'IDENTITY_OBSERVED'>>(),
				IDENTITY_FAILED: types<EventPayload<RestoreEvent | IdentityReport, 'IDENTITY_FAILED'>>()
			},
			input: types<DestinationInput>()
		},
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
			revoked: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ working: { inserting: 'revoked' } }, value),
			observationFailed: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ working: { inserting: 'observationFailed' } }, value)
		},
		actions: {
			interrupt: ({
				context,
				event
			}: {
				context: Context
				event: RestoreEvent | IdentityReport
			}) => ({
				context: {
					interruption:
						context.interruption ??
						(event.type === 'SHUTDOWN'
							? 'closed'
							: event.type === 'INVALIDATE'
								? 'invalidated'
								: 'cancelled')
				}
			})
		}
	})
	const input = ({ context }: { context: Context }) => context.input
	return model.createMachine({
		id: 'test-app-destination-write',
		initial: 'working',
		context: ({ input }) => ({ input, interruption: undefined, result: 'unavailable' }),
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: (args) => {
				return args.actions.interrupt(args)
			},
			SHUTDOWN: (args) => {
				return args.actions.interrupt(args)
			},
			INVALIDATE: (args) => {
				if (!args.guards.currentBinding(args)) return
				return args.actions.interrupt(args)
			}
		},
		states: {
			working: {
				initial: 'observingIdentity',
				invoke: {
					src: 'observeIdentity',
					input,
					onError: (args, enq) => {
						enq.raise({
							type: 'IDENTITY_FAILED',
							binding: args.context.input.binding
						})
					}
				},
				states: {
					observingIdentity: {
						always: (args) => {
							if (args.guards.interrupted(args)) {
								return { target: '#test-app-destination-write.complete' }
							}
							if (!args.guards.writeOperation(args)) {
								return { target: '#test-app-destination-write.unavailable' }
							}
						},
						on: {
							IDENTITY_OBSERVED: (args) => {
								if (args.guards.currentReport(args) && !args.guards.identityMatches(args)) {
									return { target: '#test-app-destination-write.denied' }
								}
								if (
									args.guards.currentReport(args) &&
									args.guards.identityMatches(args) &&
									args.guards.stageOperation(args)
								) {
									return { target: 'inserting' }
								}
								if (args.guards.currentReport(args) && args.guards.identityMatches(args)) {
									return { target: '#test-app-destination-write.allowed' }
								}
							},
							IDENTITY_FAILED: (args) => {
								if (!args.guards.currentReport(args)) return
								return { target: '#test-app-destination-write.unavailable' }
							}
						}
					},
					inserting: {
						initial: 'pending',
						invoke: {
							src: 'insert',
							input,
							onDone: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-destination-write.complete' }
								}
								if (args.guards.revoked(args)) {
									return { target: '#test-app-destination-write.denied' }
								}
								if (args.guards.observationFailed(args)) {
									return { target: '#test-app-destination-write.unavailable' }
								}
								if (args.event.output === 'identityMismatch') {
									return { target: '#test-app-destination-write.denied' }
								}
								return { target: '#test-app-destination-write.staged' }
							},
							onError: { target: '#test-app-destination-write.unavailable' }
						},
						states: {
							pending: {
								on: {
									IDENTITY_OBSERVED: (args) => {
										if (args.guards.currentReport(args) && args.guards.identityMatches(args)) {
											return {}
										}
										if (args.guards.currentReport(args)) {
											return { target: 'revoked' }
										}
									},
									IDENTITY_FAILED: (args) => {
										if (!args.guards.currentReport(args)) return
										return { target: 'observationFailed' }
									}
								}
							},
							revoked: { id: 'test-app-write-revoked' },
							observationFailed: { id: 'test-app-write-observation-failed' }
						}
					}
				}
			},
			allowed: {
				type: 'final',
				entry: () => {
					return { context: { result: 'allowed' } }
				}
			},
			denied: {
				type: 'final',
				entry: () => {
					return { context: { result: 'denied' } }
				}
			},
			staged: {
				type: 'final',
				entry: () => {
					return { context: { result: 'staged' } }
				}
			},
			unavailable: { type: 'final' },
			complete: { type: 'final' }
		}
	})
}

export function testAppPreparationContents(intent: RestoreJournalIntent) {
	return {
		ownerId: intent.operation.identityId,
		operationId: intent.operation.operationId,
		payloadSha256: intent.archive.payloadSha256,
		// Bind graph content without a circular dependency on the preparation digest.
		graphSha256: intent.plan.expectedGraphSha256,
		status: 'incomplete'
	} satisfies import('jazz-tools').schema.InsertOf<typeof testAppRestoreApp.restoreDestinations>
}

export function createTestAppPreparationWriteMachine(db: IdentitySource) {
	return createTestAppDestinationWriteMachine(db, (transaction, input) => {
		transaction.insert(
			testAppRestoreApp.restoreDestinations,
			testAppPreparationContents(input.intent),
			{ id: input.intent.operation.destinationWorkspaceId }
		)
	})
}

/** Finite destination operation; the shared write actor owns transaction custody and settlement. */
export function createTestAppPreparationWriter(
	db: Db,
	write = createTestAppPreparationWriteMachine(db)
) {
	type Input = RestoreDestinationInput<Transaction<'mergeable'>>
	type Context = {
		input: Input
		result: RestoreDestinationResult
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	}
	const query = (input: Input) =>
		testAppRestoreApp.restoreDestinations.where({
			id: input.intent.operation.destinationWorkspaceId
		})
	// Return only a bounded comparison fact; SDK rows never enter actor snapshots.
	const matches = (
		row: import('jazz-tools').schema.RowOf<typeof testAppRestoreApp.restoreDestinations> | null,
		input: Input
	) => {
		if (!row) return { present: false, matches: false }
		const expected = testAppPreparationContents(input.intent)
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
		remote: createAsyncLogic({
			run: ({ input }: { input: Input }) =>
				db.one(query(input), { tier: 'remote' }).then((row) => matches(row, input))
		}),
		read: createAsyncLogic({
			run: ({ input }: { input: Input }) =>
				restoreTransactionAccess(input).call((tx) =>
					tx.one(query(input)).then((row) => matches(row, input))
				)
		}),
		write
	}
	const model = setup({
		schemas: {
			output: types<RestoreDestinationResult>(),
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<RestoreEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<RestoreEvent, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<RestoreEvent, 'INVALIDATE'>>()
			},
			input: types<Input>()
		},
		actors
	})

	const input = ({ context }: { context: Context }) => context.input
	return model.createMachine({
		id: 'test-app-preparation-destination',
		initial: 'admitting',
		context: ({ input }) => ({ input, result: 'unavailable', interruption: undefined }),
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: (args) => {
				return { context: { interruption: args.context.interruption ?? 'cancelled' } }
			},
			SHUTDOWN: (args) => {
				return { context: { interruption: args.context.interruption ?? 'closed' } }
			},
			INVALIDATE: (args) => {
				const { context } = args
				if (!sameBackupBinding(context.input.binding, args.event.binding)) return
				return { context: { interruption: context.interruption ?? 'invalidated' } }
			}
		},
		states: {
			admitting: {
				always: (args) => {
					const { context } = args
					if (context.input.step.writeId !== context.input.intent.plan.preparation.writeId) {
						return { target: 'conflict' }
					}
					if (context.input.operation === 'remote') {
						return { target: 'remote' }
					}
					if (context.input.operation === 'read') {
						return { target: 'read' }
					}
					return { target: 'writing' }
				}
			},
			remote: {
				invoke: {
					src: 'remote',
					input,
					onDone: (args) => {
						const { event } = args
						if (args.context.interruption !== undefined) {
							return { target: 'complete' }
						}
						if (!event.output.present) {
							return { target: 'missing' }
						}
						if (event.output.matches) {
							return { target: 'match' }
						}
						return { target: 'conflict' }
					},
					onError: { target: 'complete' }
				}
			},
			read: {
				invoke: {
					src: 'read',
					input,
					onDone: (args) => {
						const { event } = args
						if (args.context.interruption !== undefined) {
							return { target: 'complete' }
						}
						if (!event.output.present) {
							return { target: 'missing' }
						}
						if (event.output.matches) {
							return { target: 'match' }
						}
						return { target: 'conflict' }
					},
					onError: { target: 'complete' }
				}
			},
			writing: {
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('write', args.event)
						return { context: { interruption: args.context.interruption ?? 'cancelled' } }
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('write', args.event)
						return { context: { interruption: args.context.interruption ?? 'closed' } }
					},
					INVALIDATE: (args, enq) => {
						const { context } = args
						if (!sameBackupBinding(context.input.binding, args.event.binding)) return
						enq.sendTo('write', args.event)
						return { context: { interruption: context.interruption ?? 'invalidated' } }
					}
				},

				invoke: {
					id: 'write',
					src: 'write',
					input,
					onDone: (args) => {
						return { target: 'complete', context: { result: args.event.output } }
					},
					onError: { target: 'complete' }
				}
			},
			match: {
				type: 'final',
				entry: () => {
					return { context: { result: 'match' } }
				}
			},
			missing: {
				type: 'final',
				entry: () => {
					return { context: { result: 'missingOrHidden' } }
				}
			},
			conflict: {
				type: 'final',
				entry: () => {
					return { context: { result: 'conflict' } }
				}
			},
			complete: { type: 'final' }
		}
	})
}

// Per-disposable-Db test instrumentation. Every fixture writer reports through
// this boundary, including writers created by attachment/root/note continuations.
// It owns no SDK resource and never changes an SDK method or workflow decision.
const writeObservers = new WeakMap<Db, () => void>()
export function observeTestAppWrites(db: Db, observe: () => void): () => void {
	writeObservers.set(db, observe)
	return () => {
		writeObservers.delete(db)
	}
}

/** Native transaction operations shared by destination statecharts; no domain decisions. */
export function createTestAppTransactionWriter(
	db: Db,
	retainDetached: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
) {
	return {
		open: () => db.beginTransaction(),
		commit: (transaction) => {
			writeObservers.get(db)?.()
			return transaction.commit()
		},
		transactionId: (write) => write.txId,
		persistLocal: (write) => write.wait({ tier: 'local' }),
		acceptRemote: (write) => write.wait({ tier: 'global' }),
		isRemoteRejection: (error, transactionId) =>
			error instanceof PersistedWriteRejectedError && error.transactionId === transactionId,
		rollback: (transaction) => transaction.rollback(),
		retainDetached
	} satisfies RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>
}
