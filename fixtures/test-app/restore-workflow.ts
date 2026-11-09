import type { EventPayload } from './restore-events.js'
import { createActor, createCallbackLogic, setup, createAsyncLogic, types } from 'xstate'
import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/binding'
import type {
	RestoreEvent,
	RestoreResult,
	RestoreTransactionWriter
} from 'delightful-local-first/backup/restore'
import {
	parseRestoreJournalRecord,
	type RestoreJournalRecord
} from 'delightful-local-first/backup/restore/journal'
import {
	createRestoreMachine,
	createRestoreJournalStepMachine
} from 'delightful-local-first/backup/restore/workflow'
import {
	claimTestAppRestore,
	testAppRestoreData as data,
	testAppRestoreResources,
	prepareTestAppRestore,
	requiredTestAppRestoreValue as required,
	type TestAppRestoreRequest,
	type TestAppRestoreOptions
} from './restore-request.js'
import { createTestAppRestorePlanningMachine } from './restore-planning.js'
import { testAppRecoveryIntentMatches, currentTestAppBatch } from './restore-step-data.js'
import {
	testAppCurrentStepIsAttachment,
	prepareTestAppAttachmentBytes
} from './restore-attachment-data.js'
import { testAppCurrentStepIsRoot, prepareTestAppRoot } from './restore-root.js'
import { testAppCurrentStepIsNote, prepareTestAppNote } from './restore-note.js'
import { createTestAppAttachmentWriter } from './restore-attachment-writer.js'
import { createTestAppRootWriter } from './restore-root-writer.js'
import { createTestAppNoteWriter } from './restore-note-writer.js'
import { createTestAppPreparationWriter, createTestAppTransactionWriter } from './restore-writer.js'
import {
	compareTestAppDestination,
	createTestAppActivationDestination,
	testAppDestinationGraphQuery,
	type TestAppComparison
} from './restore-comparison.js'

type Input = { request: TestAppRestoreRequest }
/** Application-owned workflow. The shared writers retain all native transaction lifetimes. */
export function createTestAppRestoreWorkflow(
	db: Db,
	writer: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>,
	request: TestAppRestoreRequest
) {
	type Context = Input & {
		binding: BackupBinding
		databaseName: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreResult
	}
	const actors = {
		resources: testAppRestoreResources,
		identity: createCallbackLogic<RestoreEvent, BackupBinding>(({ input, sendBack }) => {
			try {
				return db.onAuthChanged((state) =>
					sendBack({ type: 'IDENTITY', binding: input, identityId: state.session?.user.account })
				)
			} catch {
				sendBack({ type: 'IDENTITY_FAILED', binding: input })
			}
		}),
		journal: createRestoreJournalStepMachine(),
		plan: createTestAppRestorePlanningMachine(),
		prepare: createRestoreMachine(writer, createTestAppPreparationWriter(db)),
		attachment: createRestoreMachine(writer, createTestAppAttachmentWriter(db, request)),
		notebook: createRestoreMachine(writer, createTestAppRootWriter(db, request)),
		note: createRestoreMachine(writer, createTestAppNoteWriter(db, request)),
		activate: createRestoreMachine(writer, createTestAppActivationDestination(db, request)),
		compare: createAsyncLogic<TestAppComparison, Input>({
			run: ({ input }) =>
				db
					.one(testAppDestinationGraphQuery(data(input).binding.workspaceId), { tier: 'remote' })
					.then((row) => compareTestAppDestination(row, input.request))
		})
	}
	type Event =
		| RestoreEvent
		| {
				type: 'RELEASE' | 'CLAIMED' | 'CLAIM_FAILED' | 'EXPECTED_READY' | 'EXPECTED_FAILED'
		  }
		| { type: 'IDENTITY'; binding: BackupBinding; identityId: string | undefined }
		| { type: 'IDENTITY_FAILED'; binding: BackupBinding }
	const model = setup({
		schemas: {
			children: {
				journal: types<import('xstate').ActorRefFrom<typeof actors.journal>>(),
				effect: types<import('xstate').ActorRef<import('xstate').Snapshot<unknown>, RestoreEvent>>()
			},
			output: types<RestoreResult>(),
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				RELEASE: types<EventPayload<Event, 'RELEASE'>>(),
				CLAIMED: types<EventPayload<Event, 'CLAIMED'>>(),
				CLAIM_FAILED: types<EventPayload<Event, 'CLAIM_FAILED'>>(),
				EXPECTED_READY: types<EventPayload<Event, 'EXPECTED_READY'>>(),
				EXPECTED_FAILED: types<EventPayload<Event, 'EXPECTED_FAILED'>>(),
				IDENTITY: types<EventPayload<Event, 'IDENTITY'>>(),
				IDENTITY_FAILED: types<EventPayload<Event, 'IDENTITY_FAILED'>>()
			},
			input: types<Input>()
		},
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding)
		},
		actions: {
			interrupt: ({
				context,
				event
			}: {
				context: Context
				event:
					| RestoreEvent
					| { type: 'RELEASE' | 'CLAIMED' | 'CLAIM_FAILED' | 'EXPECTED_READY' | 'EXPECTED_FAILED' }
					| { type: 'IDENTITY'; binding: BackupBinding; identityId: string | undefined }
					| { type: 'IDENTITY_FAILED'; binding: BackupBinding }
			}) => ({
				context: {
					interruption:
						context.interruption ??
						(event.type === 'SHUTDOWN'
							? 'closed'
							: event.type === 'INVALIDATE' ||
								  event.type === 'IDENTITY' ||
								  event.type === 'IDENTITY_FAILED'
								? 'invalidated'
								: 'cancelled')
				}
			})
		}
	})

	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const writeInput = ({ context }: { context: Context }) => ({
		binding: context.binding,
		databaseName: context.databaseName,
		intent: required(data(context).intent),
		writeId: required(currentTestAppBatch(context, context.result.record)).writeId
	})
	// Retained journal metadata is the only cursor; expected content stays in the private request.
	const retainRecord = (context: Context, record: RestoreJournalRecord | undefined) => {
		data(context).observedJournal = record
	}

	const batchWrite = (src: 'attachment' | 'notebook' | 'note') =>
		model.createStateConfig({
			on: {
				CANCEL: (args, enq) => {
					enq.sendTo('effect', args.event)
					return args.actions.interrupt(args)
				},
				SHUTDOWN: (args, enq) => {
					enq.sendTo('effect', args.event)
					return args.actions.interrupt(args)
				},
				INVALIDATE: (args, enq) => {
					if (!args.guards.currentBinding(args)) return
					enq.sendTo('effect', args.event)
					return args.actions.interrupt(args)
				}
			},

			invoke: {
				id: 'effect',
				src,
				input: writeInput,
				onDone: (args, enq) => {
					const { event } = args
					if (event.output.outcome === 'batchWritten') {
						enq(() => {
							const { context, event } = args
							data(context).attachment = undefined
							data(context).notebook = undefined
							data(context).notes = undefined
							retainRecord(context, event.output.record)
						})
						return {
							target: 'selecting',
							context: { result: { ...event.output, outcome: 'incomplete' } }
						}
					}
					return {
						target: '#test-app-restore-workflow.reporting',
						context: { result: event.output }
					}
				},
				onError: { target: '#test-app-restore-workflow.reporting' }
			}
		})
	return model.createMachine({
		id: 'test-app-restore-workflow',
		initial: 'claiming',
		context: ({ input }) => ({
			...input,
			binding: data(input).binding,
			databaseName: data(input).options?.databaseName ?? '',
			interruption: undefined,
			result: { binding: data(input).binding, outcome: 'unavailable', record: undefined }
		}),
		output: ({ context }) => ({
			...context.result,
			outcome: context.interruption ?? context.result.outcome
		}),
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
			},
			RELEASE: (args, enq) => {
				enq.raise({ type: 'CANCEL' })
			},
			IDENTITY: (args, enq) => {
				const { context, event } = args
				if (
					!(
						sameBackupBinding(context.binding, event.binding) &&
						event.identityId !== context.binding.identityId
					)
				)
					return
				enq.raise({ type: 'INVALIDATE', binding: context.binding })
			},
			IDENTITY_FAILED: (args, enq) => {
				const { context } = args
				if (!sameBackupBinding(context.binding, args.event.binding)) return
				enq.raise({ type: 'INVALIDATE', binding: context.binding })
			}
		},
		states: {
			claiming: {
				entry: ({ context, self }, enq) => {
					enq(() => {
						self.send({ type: claimTestAppRestore(context) ? 'CLAIMED' : 'CLAIM_FAILED' })
					})
				},
				on: { CLAIMED: { target: 'working' }, CLAIM_FAILED: { target: 'reporting' } }
			},
			working: {
				initial: 'admitting',
				invoke: [
					{ src: 'resources', input, onError: { target: '#test-app-restore-workflow.reporting' } },
					{
						src: 'identity',
						input: ({ context }) => context.binding,
						onError: (args, enq) => {
							enq.raise({
								type: 'IDENTITY_FAILED',
								binding: args.context.binding
							})
						}
					}
				],
				states: {
					admitting: {
						always: (args) => {
							const { context } = args
							if (args.guards.interrupted(args)) {
								return { target: '#test-app-restore-workflow.reporting' }
							}
							if (data(context).options?.mode === 'new') {
								return { target: 'initializing' }
							}
							return { target: 'planning' }
						}
					},
					initializing: {
						invoke: {
							id: 'journal',
							src: 'journal',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								command: { mode: 'initialize' }
							}),
							onDone: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-restore-workflow.reporting' }
								}
								if (args.event.output.outcome === 'initialized') {
									return { target: 'planning' }
								}
								return { target: '#test-app-restore-workflow.reporting' }
							},
							onError: { target: '#test-app-restore-workflow.reporting' }
						}
					},
					planning: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							}
						},

						invoke: {
							id: 'effect',
							src: 'plan',
							input,
							onDone: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-restore-workflow.reporting' }
								}
								if (
									args.event.output.outcome === 'planned' &&
									(data(context).options?.mode === 'new' || testAppRecoveryIntentMatches(context))
								) {
									return {
										target: 'selecting',
										context: {
											result: {
												binding: context.binding,
												outcome: 'incomplete',
												record: data(context).observedJournal
											}
										}
									}
								}
								return { target: '#test-app-restore-workflow.reporting' }
							},
							onError: { target: '#test-app-restore-workflow.reporting' }
						}
					},
					selecting: {
						always: (args) => {
							const { context } = args
							if (args.guards.interrupted(args)) {
								return { target: '#test-app-restore-workflow.reporting' }
							}
							if (
								(({ context }) => {
									const checkpoint = context.result.record?.checkpoint
									return (
										!checkpoint ||
										(checkpoint.kind === 'writing' && checkpoint.completed.length === 0)
									)
								})(args)
							) {
								return { target: 'preparing' }
							}
							if (context.result.record?.checkpoint.kind === 'comparing') {
								return { target: 'comparing' }
							}
							if (
								context.result.record?.checkpoint.kind === 'activating' ||
								context.result.record?.checkpoint.kind === 'complete'
							) {
								return { target: 'activating' }
							}
							if (testAppCurrentStepIsAttachment(context, context.result.record)) {
								return { target: 'preparingAttachment' }
							}
							if (testAppCurrentStepIsRoot(context, context.result.record)) {
								return { target: 'preparingNotebook' }
							}
							if (testAppCurrentStepIsNote(context, context.result.record)) {
								return { target: 'preparingNote' }
							}
							return { target: '#test-app-restore-workflow.conflict' }
						}
					},
					preparing: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							}
						},

						invoke: {
							id: 'effect',
							src: 'prepare',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								intent: required(data(context).intent),
								writeId: required(data(context).intent).plan.preparation.writeId
							}),
							onDone: (args, enq) => {
								const { event } = args
								if (event.output.outcome === 'prepared') {
									enq(() => {
										const { context, event } = args
										return retainRecord(context, event.output.record)
									})
									return {
										target: 'selecting',
										context: { result: { ...event.output, outcome: 'incomplete' } }
									}
								}
								return {
									target: '#test-app-restore-workflow.reporting',
									context: { result: event.output }
								}
							},
							onError: { target: '#test-app-restore-workflow.reporting' }
						}
					},
					preparingAttachment: {
						entry: ({ context, self }, enq) => {
							enq(() => {
								try {
									prepareTestAppAttachmentBytes(context)
									self.send({ type: 'EXPECTED_READY' })
								} catch {
									self.send({ type: 'EXPECTED_FAILED' })
								}
							})
						},
						on: {
							EXPECTED_READY: { target: 'writingAttachment' },
							EXPECTED_FAILED: { target: '#test-app-restore-workflow.reporting' }
						}
					},
					preparingNotebook: {
						entry: ({ context, self }, enq) => {
							enq(() => {
								try {
									prepareTestAppRoot(context)
									self.send({ type: 'EXPECTED_READY' })
								} catch {
									self.send({ type: 'EXPECTED_FAILED' })
								}
							})
						},
						on: {
							EXPECTED_READY: { target: 'writingNotebook' },
							EXPECTED_FAILED: { target: '#test-app-restore-workflow.reporting' }
						}
					},
					preparingNote: {
						entry: ({ context, self }, enq) => {
							enq(() => {
								try {
									prepareTestAppNote(context)
									self.send({ type: 'EXPECTED_READY' })
								} catch {
									self.send({ type: 'EXPECTED_FAILED' })
								}
							})
						},
						on: {
							EXPECTED_READY: { target: 'writingNote' },
							EXPECTED_FAILED: { target: '#test-app-restore-workflow.reporting' }
						}
					},
					writingAttachment: batchWrite('attachment'),
					writingNotebook: batchWrite('notebook'),
					writingNote: batchWrite('note'),
					comparing: {
						invoke: {
							id: 'effect',
							src: 'compare',
							input,
							onDone: (args) => {
								const { event } = args
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-restore-workflow.reporting' }
								}
								if (event.output === 'incompleteMatch') {
									return { target: 'savingComparison' }
								}
								if (event.output === 'conflict' || event.output === 'activeMatch') {
									return { target: '#test-app-restore-workflow.conflict' }
								}
								return { target: '#test-app-restore-workflow.reporting' }
							},
							onError: { target: '#test-app-restore-workflow.reporting' }
						}
					},
					savingComparison: {
						invoke: {
							id: 'journal',
							src: 'journal',
							input: ({ context }) => {
								const record = required(context.result.record)
								return {
									binding: context.binding,
									databaseName: context.databaseName,
									command: {
										mode: 'update',
										expectedRevision: record.revision,
										record: parseRestoreJournalRecord({
											...record,
											revision: record.revision + 1,
											checkpoint: {
												kind: 'activating',
												completed:
													record.checkpoint.kind === 'conflict'
														? record.checkpoint.prior.completed
														: record.checkpoint.completed,
												comparison: {
													payloadSha256: record.intent.archive.payloadSha256,
													graphSha256: record.intent.plan.expectedGraphSha256
												},
												current: {
													status: 'notIssued',
													writeId: record.intent.plan.activation.writeId,
													issuance: 0
												}
											}
										})
									}
								}
							},
							onDone: (args, enq) => {
								const { context, event } = args
								if (event.output.outcome === 'updated' && event.output.record !== undefined) {
									enq(() => {
										const { context, event } = args
										return retainRecord(context, event.output.record)
									})
									return {
										target: 'selecting',
										context: {
											result: {
												...context.result,
												record: event.output.record
											}
										}
									}
								}
								return { target: '#test-app-restore-workflow.reporting' }
							},
							onError: { target: '#test-app-restore-workflow.reporting' }
						}
					},
					activating: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							}
						},

						invoke: {
							id: 'effect',
							src: 'activate',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								intent: required(data(context).intent),
								writeId: required(data(context).intent).plan.activation.writeId
							}),
							onDone: (args) => {
								return {
									target: '#test-app-restore-workflow.reporting',
									context: { result: args.event.output }
								}
							},
							onError: { target: '#test-app-restore-workflow.reporting' }
						}
					}
				}
			},
			conflict: {
				type: 'final',
				entry: (args) => {
					return { context: { result: { ...args.context.result, outcome: 'conflict' } } }
				}
			},
			reporting: {
				always: (args) => {
					const { context } = args
					if (context.interruption === 'cancelled') {
						return { target: 'cancelled' }
					}
					if (context.interruption === 'closed') {
						return { target: 'closed' }
					}
					if (context.interruption === 'invalidated') {
						return { target: 'invalidated' }
					}
					if (context.result.outcome === 'complete') {
						return { target: 'succeeded' }
					}
					if (context.result.outcome === 'conflict') {
						return { target: 'conflict' }
					}
					if (context.result.outcome === 'unavailable') {
						return { target: 'unavailable' }
					}
					return { target: 'incomplete' }
				}
			},
			succeeded: { type: 'final' },
			incomplete: {
				type: 'final',
				entry: (args) => {
					return { context: { result: { ...args.context.result, outcome: 'incomplete' } } }
				}
			},
			unavailable: { type: 'final' },
			cancelled: { type: 'final' },
			closed: { type: 'final' },
			invalidated: { type: 'final' }
		}
	})
}

export function createTestAppRestore(
	options: TestAppRestoreOptions & {
		db: Db
		retainDetached: RestoreTransactionWriter<
			Transaction<'mergeable'>,
			WriteHandle
		>['retainDetached']
	}
) {
	const request = prepareTestAppRestore({
		mode: options.mode,
		binding: options.binding,
		databaseName: options.databaseName,
		archive: options.archive
	})
	const writer = createTestAppTransactionWriter(options.db, options.retainDetached)
	return {
		request,
		actor: createActor(createTestAppRestoreWorkflow(options.db, writer, request), {
			input: { request }
		})
	}
}
