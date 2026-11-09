import { matchesState, type StateValue, types, createAsyncLogic, setup } from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
import {
	createTransactionCustody,
	clearTransactionCustody,
	transactionCall,
	transactionCustodian,
	type TransactionCustody
} from './transaction-custody.js'
import type {
	WorkspaceCreationAssessment,
	WorkspaceCreationAttempt,
	WorkspaceCreationEvent,
	WorkspaceCreationOutcome,
	WorkspaceCreationResult,
	WorkspaceCreationTransactionCapability
} from '../../contracts/workspace-creation.js'
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing workspace creation resource')
	return value
}
/** One atomic transaction. Callers journal intent before invocation and reconcile unknown outcomes. */
export function createWorkspaceCreationTransaction<Draft, Transaction, Records, Workspace, Write>(
	capability: WorkspaceCreationTransactionCapability<Draft, Transaction, Records, Workspace, Write>
) {
	type Attempt = WorkspaceCreationAttempt<Draft>
	type Outcome = WorkspaceCreationOutcome<Workspace>
	type Custody = TransactionCustody<Transaction, Write>
	type Context = {
		custody: Custody
		attempt: Attempt
		result: Outcome | undefined
		resources: {
			transaction: Transaction | undefined
			workspace: Workspace | undefined
			write: Write | undefined
			records: Records | undefined
		}
	}
	const actors = {
		custodian: transactionCustodian<Transaction, Write>(),
		open: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					custody: Custody
				}
			}) => {
				const call = transactionCall(input.custody, () => capability.open())
				input.custody.recordAcquisition(call)
				return call
			}
		}),
		read: createAsyncLogic({
			run: async ({
				input
			}: {
				input: {
					transaction: Transaction
					attempt: Attempt
					custody: Custody
				}
			}) =>
				transactionCall(input.custody, () => capability.readLocal(input.transaction, input.attempt))
		}),
		assess: createAsyncLogic({
			run: async ({
				input
			}: {
				input: {
					records: Records
					attempt: Attempt
				}
			}) => capability.assess(input.records, input.attempt)
		}),
		stage: createAsyncLogic({
			run: async ({
				input
			}: {
				input: {
					transaction: Transaction
					attempt: Attempt
					custody: Custody
				}
			}) => transactionCall(input.custody, () => capability.stage(input.transaction, input.attempt))
		}),
		commit: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					transaction: Transaction
					custody: Custody
				}
			}) => {
				const call = transactionCall(input.custody, () => capability.commit(input.transaction))
				input.custody.recordCommit(call)
				return call
			}
		}),
		persist: createAsyncLogic({
			run: async ({
				input
			}: {
				input: {
					write: Write
					custody: Custody
				}
			}) => transactionCall(input.custody, () => capability.persistLocal(input.write))
		}),
		rollback: createAsyncLogic({
			run: async ({
				input
			}: {
				input: {
					transaction: Transaction
					custody: Custody
				}
			}) => transactionCall(input.custody, () => capability.rollback(input.transaction))
		})
	}
	type FullContext = Context
	const model = setup({
		schemas: {
			context: types<FullContext>(),
			events: {
				CANCEL: types<EventPayload<WorkspaceCreationEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<WorkspaceCreationEvent, 'SHUTDOWN'>>()
			},
			input: types<{
				attempt: Attempt
			}>(),
			output: types<WorkspaceCreationResult<Draft, Workspace>>()
		},
		actors,
		guards: {
			cancelling: ({ value }: { value: StateValue }) =>
				matchesState({ running: { control: 'cancelling' } }, value),
			closing: ({ value }: { value: StateValue }) =>
				matchesState({ running: { control: 'closing' } }, value)
		}
	})
	const fail = (error: unknown, unresolved = false): Outcome => ({
		outcome: 'failed',
		error,
		settlement: unresolved ? { kind: 'unresolved', error } : { kind: 'notStarted' }
	})
	const transactionInput = ({ context }: { context: FullContext }) => ({
		custody: context.custody,
		transaction: required(context.resources.transaction),
		attempt: context.attempt
	})
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		cancelled: (args, _enq) => {
			return {
				context: {
					result: {
						outcome: 'cancelled',
						settlement: args.context.result?.settlement ?? { kind: 'notStarted' }
					}
				} satisfies Partial<FullContext>
			}
		},
		closed: (args, _enq) => {
			return {
				context: {
					result: {
						outcome: 'closed',
						settlement: args.context.result?.settlement ?? { kind: 'notStarted' }
					}
				} satisfies Partial<FullContext>
			}
		}
	} satisfies Record<
		string,
		(
			args: CompletionArgs,
			enq: CompletionQueue
		) => void | {
			context?: Partial<FullContext>
		}
	>
	const complete = createFinalTransitions<
		FullContext,
		CompletionArgs,
		CompletionQueue,
		keyof typeof finalizers
	>(finalizers)
	return model.createMachine({
		id: 'workspace-creation-transaction',
		context: ({ input }) => ({
			custody: createTransactionCustody(capability.retainDetached),
			attempt: input.attempt,
			result: undefined,
			resources: {
				transaction: undefined,
				records: undefined,
				workspace: undefined,
				write: undefined
			}
		}),
		initial: 'running',
		output: ({ context }) => ({ ...required(context.result), attempt: context.attempt }),
		states: {
			running: {
				type: 'parallel',
				invoke: {
					src: actors.custodian,
					input: ({ context, self }) => ({ custody: context.custody, owner: self }),
					onError: (args, enq) => {
						enq(() => {
							throw new Error('Transaction custody failed')
						})
					}
				},
				states: {
					control: {
						initial: 'active',
						states: {
							active: { on: { CANCEL: { target: 'cancelling' }, SHUTDOWN: { target: 'closing' } } },
							cancelling: { on: { CANCEL: {}, SHUTDOWN: { target: 'closing' } } },
							closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
						}
					},
					work: {
						initial: 'opening',
						states: {
							opening: {
								invoke: {
									src: actors.open,
									input: ({ context }) => ({ custody: context.custody }),
									onDone: (args) => {
										return {
											target: 'checkingAfterOpen',
											context: {
												resources: {
													...args.context.resources,
													transaction: args.event.output
												}
											} satisfies Partial<FullContext>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: { result: fail(args.event.error) } satisfies Partial<FullContext>
										}
									}
								}
							},
							checkingAfterOpen: {
								always: (args) => {
									if (args.guards.closing(args)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'rollingBack' }
									}
									return { target: 'readingLocal' }
								}
							},
							readingLocal: {
								invoke: {
									src: actors.read,
									input: transactionInput,
									onDone: (args) => {
										return {
											target: 'checkingAfterRead',
											context: {
												resources: {
													...args.context.resources,
													records: args.event.output
												}
											} satisfies Partial<FullContext>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: { result: fail(args.event.error) } satisfies Partial<FullContext>
										}
									}
								}
							},
							checkingAfterRead: {
								always: (args) => {
									if (args.guards.closing(args)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'rollingBack' }
									}
									return { target: 'assessing' }
								}
							},
							assessing: {
								invoke: {
									src: actors.assess,
									input: ({ context }) => ({
										records: required(context.resources.records),
										attempt: context.attempt
									}),
									onDone: (args) => {
										const { event } = args
										if (args.guards.closing(args)) {
											return { target: 'rollingBack' }
										}
										if (args.guards.cancelling(args)) {
											return { target: 'rollingBack' }
										}
										if (event.output.outcome === 'eligible') {
											return { target: 'staging' }
										}
										return {
											target: 'rollingBack',
											context: {
												result: (({ event }): Outcome => {
													const assessment: WorkspaceCreationAssessment = event.output
													if (assessment.outcome !== 'blocked')
														throw new Error('Expected blocked creation')
													return {
														outcome: 'blocked',
														reason: assessment.reason,
														settlement: { kind: 'notStarted' }
													}
												})(args)
											} satisfies Partial<FullContext>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: { result: fail(args.event.error) } satisfies Partial<FullContext>
										}
									}
								}
							},
							staging: {
								invoke: {
									src: actors.stage,
									input: transactionInput,
									onDone: (args) => {
										return {
											target: 'checkingBeforeCommit',
											context: {
												resources: {
													...args.context.resources,
													workspace: args.event.output
												}
											} satisfies Partial<FullContext>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: { result: fail(args.event.error) } satisfies Partial<FullContext>
										}
									}
								}
							},
							checkingBeforeCommit: {
								always: (args) => {
									if (args.guards.closing(args)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'rollingBack' }
									}
									return { target: 'committing' }
								}
							},
							committing: {
								invoke: {
									src: actors.commit,
									input: ({ context }) => ({
										transaction: required(context.resources.transaction),
										custody: context.custody
									}),
									onDone: (args) => {
										return {
											target: 'persistingLocal',
											context: {
												resources: {
													...args.context.resources,
													write: args.event.output
												}
											} satisfies Partial<FullContext>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: {
												result: fail(args.event.error, true)
											} satisfies Partial<FullContext>
										}
									}
								}
							},
							persistingLocal: {
								invoke: {
									src: actors.persist,
									input: ({ context }) => ({
										write: required(context.resources.write),
										custody: context.custody
									}),
									onDone: (args, enq) => {
										const { context } = args
										enq(({ context }) => clearTransactionCustody(context.custody), args)
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'succeeded',
													settlement: {
														kind: 'locallyPersisted',
														workspace: required(context.resources.workspace)
													}
												}
											} satisfies Partial<FullContext>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: {
												result: fail(args.event.error, true)
											} satisfies Partial<FullContext>
										}
									}
								}
							},
							rollingBack: {
								invoke: {
									src: actors.rollback,
									input: ({ context }) => ({
										transaction: required(context.resources.transaction),
										custody: context.custody
									}),
									onDone: (args, enq) => {
										const { context, event } = args
										if (event.output && context.result?.settlement.kind !== 'unresolved') {
											enq(() => clearTransactionCustody(context.custody))
											return { target: 'finishing' }
										}
										if (event.output) {
											return { target: 'finishing' }
										}
										return {
											target: 'finishing',
											context: {
												result: fail(new Error('Workspace rollback not confirmed'), true)
											} satisfies Partial<FullContext>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: fail(args.event.error, true)
											} satisfies Partial<FullContext>
										}
									}
								}
							},
							finishing: {
								always: (args, enq) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										{
											return complete('closed', args, enq, {
												target: '#workspace-creation-transaction.closed'
											})
										}
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										{
											return complete('cancelled', args, enq, {
												target: '#workspace-creation-transaction.cancelled'
											})
										}
									}
									return { target: '#workspace-creation-transaction.completed' }
								}
							}
						}
					}
				}
			},
			completed: {
				always: (args) => {
					const { context } = args
					if (context.result?.outcome === 'succeeded') {
						return { target: 'succeeded' }
					}
					if (context.result?.outcome === 'blocked') {
						return { target: 'blocked' }
					}
					return { target: 'failed' }
				}
			},
			succeeded: { type: 'final' },
			blocked: { type: 'final' },
			failed: { type: 'final' },
			cancelled: {
				type: 'final'
			},
			closed: {
				type: 'final'
			}
		}
	})
}
