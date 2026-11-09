import {
	matchesState,
	type StateValue,
	types,
	createAsyncLogic,
	setup,
	type ActorLogic,
	type Snapshot
} from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type { WorkspaceJournalEvent } from './journal.js'
import type {
	CreationBinding,
	CreationRequest as Request,
	CreationResult as Result,
	CreationRecord
} from './creation-owner.js'
import type { WorkspaceJournalResult, WorkspaceJournalInput } from './journal.js'
export type CreationPersistenceResult<Workspace> =
	| {
			outcome: 'succeeded'
			settlement: 'locallyPersisted'
			workspace: Workspace
	  }
	| {
			outcome: 'profileUnavailable' | 'conflict'
			settlement: 'notStarted'
	  }
	| {
			outcome: 'failed'
			settlement: 'notStarted' | 'unresolved'
			error: unknown
	  }
	| {
			outcome: 'cancelled' | 'closed'
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	  }
/** absent is an observation only. notStarted requires host evidence that this exact attempt
 * never issued a write (or its write was conclusively rolled back/rejected). matching includes
 * exact content validation and local durability, not merely a query returning a row.
 */
export type CreationReconciliation<Workspace> =
	| {
			outcome: 'absent' | 'notStarted' | 'conflict' | 'profileUnavailable'
	  }
	| {
			outcome: 'matching'
			workspace: Workspace
	  }
export type CreationEvent = {
	type: 'CANCEL' | 'SHUTDOWN'
}
export type CreationChild<S extends Snapshot<unknown>, Input> = ActorLogic<S, CreationEvent, Input>
export type ReconciliationLogic<S extends Snapshot<unknown>, Input> = ActorLogic<
	S,
	{
		type: 'CHECK'
	},
	Input
>
export type JournalLogic<S extends Snapshot<unknown>, Input> = ActorLogic<
	S,
	WorkspaceJournalEvent,
	Input
>
export type CreationJournalInput<Record> = WorkspaceJournalInput<Record>
export function createWorkspaceCreationOperation<
	Db,
	Workspace,
	Record extends CreationRecord,
	JournalSnapshot extends Snapshot<WorkspaceJournalResult<Record>>,
	ReconcileSnapshot extends Snapshot<CreationReconciliation<Workspace>>,
	PersistSnapshot extends Snapshot<CreationPersistenceResult<Workspace>>,
	Binding extends CreationBinding = CreationBinding
>(options: {
	db: Db
	validate: (name: string) => Promise<string>
	prepare: (input: { binding: Binding; name: string }) => Promise<Record>
	journal: JournalLogic<JournalSnapshot, CreationJournalInput<Record>>
	reconcile: ReconciliationLogic<
		ReconcileSnapshot,
		{
			db: Db
			attempt: Record['attempt']
		}
	>
	persist: CreationChild<
		PersistSnapshot,
		{
			attempt: Record['attempt']
			issuance: 'new' | 'unknown'
		}
	>
	matchesBinding: (record: Record, binding: Binding) => boolean
	attemptId: (record: Record) => string
}) {
	type WorkspaceJournalRecord = Record
	type CreationRequest = Request<Record>
	type CreationResult = Result<Record, Workspace>
	type JournalResult = WorkspaceJournalResult<Record>
	type ReconciliationResult = CreationReconciliation<Workspace>
	type WorkspacePersistenceResult = CreationPersistenceResult<Workspace>
	type Input = {
		binding: Binding
		request: CreationRequest
	}
	type Event = CreationEvent
	const db = options.db
	const validate = createAsyncLogic({
		run: async ({ input }: { input: string }) => options.validate(input)
	})
	const prepare = createAsyncLogic({
		run: async ({
			input
		}: {
			input: {
				binding: Binding
				name: string
			}
		}) => options.prepare(input)
	})
	const actors = {
		validate,
		prepare,
		journal: options.journal,
		reconcile: options.reconcile,
		persist: options.persist
	}
	type Context = Input & {
		db: Db
		name: string
		record: WorkspaceJournalRecord | undefined
		journal: JournalResult | undefined
		reconciliation: ReconciliationResult | undefined
		persistence: WorkspacePersistenceResult | undefined
		result: CreationResult
	}
	function required<T>(value: T | undefined): T {
		if (value === undefined) throw new Error('Missing creation operation value')
		return value
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
			},
			input: types<Input>(),
			output: types<CreationResult>()
		},
		actors,
		guards: {
			closing: ({ value }: { value: StateValue }) =>
				matchesState({ running: { control: 'closing' } }, value),
			cancelling: ({ value }: { value: StateValue }) =>
				matchesState({ running: { control: 'cancelling' } }, value),
			hasSettlementEvidence: ({ context }: { context: Context }) =>
				context.result.settlement !== 'notStarted' ||
				context.reconciliation?.outcome === 'notStarted' ||
				context.persistence?.settlement === 'notStarted',
			recoveringUnknownAttempt: ({ context }: { context: Context }) =>
				context.record !== undefined &&
				(context.request.mode === 'load' ||
					(context.request.mode === 'retry' && context.request.settlement === 'unresolved'))
		}
	})
	return model.createMachine({
		id: 'workspace-creation-operation',
		initial: 'running',
		context: ({ input }) => ({
			...input,
			db,
			name: '',
			record: 'record' in input.request ? input.request.record : undefined,
			journal: undefined,
			reconciliation: undefined,
			persistence: undefined,
			result: { outcome: 'editing', record: undefined, settlement: 'notStarted' }
		}),
		output: ({ context }) => context.result,
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: {
							active: {
								on: {
									CANCEL: {
										target: 'cancelling'
									},
									SHUTDOWN: {
										target: 'closing'
									}
								}
							},
							cancelling: {
								on: {
									CANCEL: {},
									SHUTDOWN: {
										target: 'closing'
									}
								}
							},
							closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
						}
					},
					work: {
						initial: 'dispatching',
						states: {
							dispatching: {
								always: (args) => {
									const { context } = args
									if (context.request.mode === 'load') {
										return { target: 'readingJournal' }
									}
									if (context.request.mode === 'clear') {
										return { target: 'clearingJournal' }
									}
									if (context.request.mode === 'retry') {
										return { target: 'checkingBinding' }
									}
									return { target: 'validating' }
								}
							},
							validating: {
								invoke: model.createInvoke<typeof actors.validate, Context>({
									src: actors.validate,
									input: ({ context }) =>
										context.request.mode === 'create' ? context.request.name : '',
									onDone: (args) => {
										return {
											target: 'checkingName',
											context: { name: args.event.output } satisfies Partial<Context>
										}
									},
									onError: (_args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'invalid',
													record: undefined,
													settlement: 'notStarted'
												}
											} satisfies Partial<Context>
										}
									}
								})
							},
							checkingName: {
								always: (args) => {
									if (args.guards.closing(args)) {
										return { target: 'finishing' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'finishing' }
									}
									return { target: 'preparing' }
								}
							},
							preparing: {
								invoke: model.createInvoke<typeof actors.prepare, Context>({
									src: actors.prepare,
									input: ({ context }) => ({ binding: context.binding, name: context.name }),
									onDone: (args) => {
										return {
											target: 'checkingBinding',
											context: { record: args.event.output } satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													record: args.context.record,
													settlement: 'notStarted',
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								})
							},
							checkingBinding: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (
										context.record?.key === context.binding.key &&
										options.matchesBinding(context.record, context.binding)
									) {
										return { target: 'recordingJournal' }
									}
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'conflict',
												record: context.record,
												settlement: 'notStarted'
											}
										} satisfies Partial<Context>
									}
								}
							},
							readingJournal: {
								on: {
									CANCEL: (args, enq) => {
										if (
											!(
												!matchesState({ running: { control: 'closing' } }, args.value) &&
												!matchesState({ running: { control: 'cancelling' } }, args.value)
											)
										)
											return
										enq.sendTo('effect', args.event)
									},
									SHUTDOWN: (args, enq) => {
										if (matchesState({ running: { control: 'closing' } }, args.value)) return
										enq.sendTo('effect', args.event)
									}
								},
								invoke: model.createInvoke<typeof actors.journal, Context>({
									id: 'effect',
									src: actors.journal,
									input: ({ context }) => ({ key: context.binding.key, mode: 'read' }),
									onDone: (args) => {
										const { event } = args
										return {
											target: 'checkingLoadedJournal',
											context: {
												journal: event.output,
												record:
													event.output?.outcome === 'succeeded'
														? event.output.record
														: args.context.record
											} satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													record: args.context.record,
													settlement: 'notStarted',
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								})
							},
							checkingLoadedJournal: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (
										context.journal?.outcome === 'succeeded' &&
										context.journal.record === undefined
									) {
										return { target: 'finishing' }
									}
									if (
										context.journal?.outcome === 'succeeded' &&
										context.journal.record !== undefined
									) {
										return {
											target: 'checkingLoadedBinding',
											context: {
												record:
													context.journal?.outcome === 'succeeded'
														? context.journal.record
														: undefined
											} satisfies Partial<Context>
										}
									}
									return { target: 'journalFailure' }
								}
							},
							checkingLoadedBinding: {
								always: (args) => {
									const { context } = args
									if (
										context.record?.key === context.binding.key &&
										options.matchesBinding(context.record, context.binding)
									) {
										return { target: 'reconciling' }
									}
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'conflict',
												record: context.record,
												settlement: 'notStarted'
											}
										} satisfies Partial<Context>
									}
								}
							},
							recordingJournal: {
								on: {
									CANCEL: (args, enq) => {
										if (
											!(
												!matchesState({ running: { control: 'closing' } }, args.value) &&
												!matchesState({ running: { control: 'cancelling' } }, args.value)
											)
										)
											return
										enq.sendTo('effect', args.event)
									},
									SHUTDOWN: (args, enq) => {
										if (matchesState({ running: { control: 'closing' } }, args.value)) return
										enq.sendTo('effect', args.event)
									}
								},
								invoke: model.createInvoke<typeof actors.journal, Context>({
									id: 'effect',
									src: actors.journal,
									input: ({ context }) => ({
										key: context.binding.key,
										mode: 'write',
										record: required(context.record)
									}),
									onDone: (args) => {
										return {
											target: 'checkingRecordedJournal',
											context: { journal: args.event.output } satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													record: args.context.record,
													settlement: 'notStarted',
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								})
							},
							checkingRecordedJournal: {
								always: (args) => {
									if (args.guards.closing(args)) {
										return { target: 'finishing' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'finishing' }
									}
									return { target: 'checkingRecordedOutcome' }
								}
							},
							checkingRecordedOutcome: {
								always: (args) => {
									if (args.context.journal?.outcome === 'succeeded') {
										return { target: 'persisting' }
									}
									return { target: 'journalFailure' }
								}
							},
							clearingJournal: {
								on: {
									CANCEL: (args, enq) => {
										if (
											!(
												!matchesState({ running: { control: 'closing' } }, args.value) &&
												!matchesState({ running: { control: 'cancelling' } }, args.value)
											)
										)
											return
										enq.sendTo('effect', args.event)
									},
									SHUTDOWN: (args, enq) => {
										if (matchesState({ running: { control: 'closing' } }, args.value)) return
										enq.sendTo('effect', args.event)
									}
								},
								invoke: model.createInvoke<typeof actors.journal, Context>({
									id: 'effect',
									src: actors.journal,
									input: ({ context }) => ({
										key: context.binding.key,
										mode: 'clear',
										attemptId: options.attemptId(required(context.record))
									}),
									onDone: (args) => {
										return {
											target: 'checkingClearedJournal',
											context: { journal: args.event.output } satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													record: args.context.record,
													settlement: 'notStarted',
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								})
							},
							checkingClearedJournal: {
								always: (args) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (args.context.journal?.outcome === 'succeeded') {
										return {
											target: 'finishing',
											context: { record: undefined } satisfies Partial<Context>
										}
									}
									return { target: 'journalFailure' }
								}
							},
							journalFailure: {
								always: (args) => {
									const { context } = args
									if (context.journal?.outcome === 'conflict') {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'conflict',
													record: context.record,
													settlement: 'notStarted'
												}
											} satisfies Partial<Context>
										}
									}
									return {
										target: 'finishing',
										context: {
											result: {
												record: context.record,
												settlement: 'notStarted',
												outcome: 'failed',
												error:
													context.journal?.outcome === 'failed'
														? context.journal.error
														: new Error('Journal was interrupted')
											}
										} satisfies Partial<Context>
									}
								}
							},
							reconciling: {
								invoke: model.createInvoke<typeof actors.reconcile, Context>({
									src: actors.reconcile,
									input: ({ context }) => ({
										db: context.db,
										attempt: required(context.record).attempt
									}),
									onDone: (args) => {
										return {
											target: 'checkingReconciliation',
											context: { reconciliation: args.event.output } satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													record: args.context.record,
													settlement: 'notStarted',
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								})
							},
							checkingReconciliation: {
								always: (args) => {
									const { context } = args
									if (context.reconciliation?.outcome === 'matching') {
										return {
											target: 'finishing',
											context: {
												result: (({ context }): CreationResult => {
													const result = required(context.reconciliation)
													if (result.outcome !== 'matching')
														throw new Error('Expected completed creation')
													return {
														outcome: 'complete',
														record: required(context.record),
														workspace: result.workspace,
														settlement: 'locallyPersisted'
													}
												})(args)
											} satisfies Partial<Context>
										}
									}
									if (context.reconciliation?.outcome === 'notStarted') {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'recovered',
													record: required(context.record),
													settlement: 'notStarted'
												}
											} satisfies Partial<Context>
										}
									}
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'unresolved',
												record: context.record,
												settlement: 'unresolved',
												error: new Error('Prior creation issuance is unknown')
											}
										} satisfies Partial<Context>
									}
								}
							},
							persisting: {
								on: {
									CANCEL: (args, enq) => {
										if (
											!(
												!matchesState({ running: { control: 'closing' } }, args.value) &&
												!matchesState({ running: { control: 'cancelling' } }, args.value)
											)
										)
											return
										enq.sendTo('effect', args.event)
									},
									SHUTDOWN: (args, enq) => {
										if (matchesState({ running: { control: 'closing' } }, args.value)) return
										enq.sendTo('effect', args.event)
									}
								},
								invoke: model.createInvoke<typeof actors.persist, Context>({
									id: 'effect',
									src: actors.persist,
									input: ({ context }) => ({
										attempt: required(context.record).attempt,
										issuance:
											context.request.mode === 'create' ||
											(context.request.mode === 'retry' &&
												context.request.settlement === 'notStarted')
												? 'new'
												: 'unknown'
									}),
									onDone: (args) => {
										return {
											target: 'checkingPersistence',
											context: { persistence: args.event.output } satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													record: args.context.record,
													outcome: 'unresolved',
													settlement: 'unresolved',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								})
							},
							checkingPersistence: {
								always: (args) => {
									const { context } = args
									if (context.persistence?.outcome === 'succeeded') {
										return {
											target: 'finishing',
											context: {
												result: (({ context }): CreationResult => {
													const result = required(context.persistence)
													if (result.outcome !== 'succeeded')
														throw new Error('Expected completed creation')
													return {
														outcome: 'complete',
														record: required(context.record),
														workspace: result.workspace,
														settlement: 'locallyPersisted'
													}
												})(args)
											} satisfies Partial<Context>
										}
									}
									if (context.persistence?.settlement === 'unresolved') {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'unresolved',
													record: context.record,
													settlement: 'unresolved',
													error:
														context.persistence?.outcome === 'failed'
															? context.persistence.error
															: new Error('Workspace persistence settlement is unresolved')
												}
											} satisfies Partial<Context>
										}
									}
									if (
										context.persistence?.outcome === 'conflict' ||
										context.persistence?.outcome === 'profileUnavailable'
									) {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'conflict',
													record: context.record,
													settlement: 'notStarted'
												}
											} satisfies Partial<Context>
										}
									}
									return {
										target: 'finishing',
										context: {
											result: {
												record: context.record,
												settlement: 'notStarted',
												outcome: 'failed',
												error:
													context.persistence?.outcome === 'failed'
														? context.persistence.error
														: new Error('Workspace persistence was interrupted')
											}
										} satisfies Partial<Context>
									}
								}
							},
							finishing: {
								always: (args) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: '#workspace-creation-operation.closing' }
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return { target: '#workspace-creation-operation.cancelling' }
									}
									return { target: '#workspace-creation-operation.checkingSettlement' }
								}
							}
						}
					}
				}
			},
			closing: {
				entry: (args) => {
					const { context } = args
					return {
						context: {
							result: {
								outcome: 'closed',
								record: context.record,
								settlement: context.persistence?.settlement ?? context.result.settlement
							}
						} satisfies Partial<Context>
					}
				},
				always: { target: 'checkingSettlement' }
			},
			cancelling: {
				entry: (args) => {
					const { context } = args
					return {
						context: {
							result: {
								outcome: 'cancelled',
								record: context.record,
								settlement: context.persistence?.settlement ?? context.result.settlement
							}
						} satisfies Partial<Context>
					}
				},
				always: { target: 'checkingSettlement' }
			},
			checkingSettlement: {
				always: (args) => {
					if (args.guards.hasSettlementEvidence(args)) {
						return { target: 'classifyingOutcome' }
					}
					if (args.guards.recoveringUnknownAttempt(args)) {
						return { target: 'unresolvedSettlement' }
					}
					return { target: 'classifyingOutcome' }
				}
			},
			unresolvedSettlement: {
				always: (args) => {
					const { context } = args
					if (context.result.outcome === 'closed') {
						return {
							target: 'closed',
							context: {
								result: {
									outcome: 'closed',
									record: context.record,
									settlement: 'unresolved'
								}
							} satisfies Partial<Context>
						}
					}
					if (context.result.outcome === 'cancelled') {
						return {
							target: 'cancelled',
							context: {
								result: {
									outcome: 'cancelled',
									record: context.record,
									settlement: 'unresolved'
								}
							} satisfies Partial<Context>
						}
					}
					return {
						target: 'unresolved',
						context: {
							result: {
								outcome: 'unresolved',
								record: context.record,
								settlement: 'unresolved',
								error:
									context.result.outcome === 'failed'
										? context.result.error
										: new Error('Prior creation issuance is unknown')
							}
						} satisfies Partial<Context>
					}
				}
			},
			classifyingOutcome: {
				always: (args) => {
					const { context } = args
					if (context.result.outcome === 'closed') {
						return { target: 'closed' }
					}
					if (context.result.outcome === 'cancelled') {
						return { target: 'cancelled' }
					}
					if (context.result.outcome === 'complete') {
						return { target: 'complete' }
					}
					if (context.result.outcome === 'editing') {
						return { target: 'editing' }
					}
					if (context.result.outcome === 'invalid') {
						return { target: 'invalid' }
					}
					if (context.result.outcome === 'recovered') {
						return { target: 'recovered' }
					}
					if (context.result.outcome === 'conflict') {
						return { target: 'conflict' }
					}
					if (context.result.outcome === 'unresolved') {
						return { target: 'unresolved' }
					}
					return { target: 'failed' }
				}
			},
			complete: { type: 'final' },
			editing: { type: 'final' },
			invalid: { type: 'final' },
			recovered: { type: 'final' },
			conflict: { type: 'final' },
			unresolved: { type: 'final' },
			failed: { type: 'final' },
			closed: { type: 'final' },
			cancelled: { type: 'final' }
		}
	})
}
