import {
	createTransactionCustody,
	clearTransactionCustody,
	transactionCall,
	transactionCustodian,
	type TransactionCustody
} from './transaction-custody.js'
import { assign, fromPromise, setup, stateIn } from 'xstate'
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
		transaction: Transaction | undefined
		workspace: Workspace | undefined
		write: Write | undefined
		result: Outcome | undefined
	}
	const actors = {
		custodian: transactionCustodian<Transaction, Write>(),
		open: fromPromise(({ input }: { input: { custody: Custody } }) => {
			const call = transactionCall(input.custody, () => capability.open())
			input.custody.acquisition = call
			return call
		}),
		read: fromPromise(
			async ({
				input
			}: {
				input: { transaction: Transaction; attempt: Attempt; custody: Custody }
			}) =>
				transactionCall(input.custody, () => capability.readLocal(input.transaction, input.attempt))
		),
		assess: fromPromise(async ({ input }: { input: { records: Records; attempt: Attempt } }) =>
			capability.assess(input.records, input.attempt)
		),
		stage: fromPromise(
			async ({
				input
			}: {
				input: { transaction: Transaction; attempt: Attempt; custody: Custody }
			}) => transactionCall(input.custody, () => capability.stage(input.transaction, input.attempt))
		),
		commit: fromPromise(({ input }: { input: { transaction: Transaction; custody: Custody } }) => {
			const call = transactionCall(input.custody, () => capability.commit(input.transaction))
			input.custody.commit = call
			return call
		}),
		persist: fromPromise(async ({ input }: { input: { write: Write; custody: Custody } }) =>
			transactionCall(input.custody, () => capability.persistLocal(input.write))
		),
		rollback: fromPromise(
			async ({ input }: { input: { transaction: Transaction; custody: Custody } }) =>
				transactionCall(input.custody, () => capability.rollback(input.transaction))
		)
	}
	type FullContext = Context & { records: Records | undefined }
	const model = setup<
		FullContext,
		WorkspaceCreationEvent,
		typeof actors,
		{},
		{},
		{ cancelling: undefined; closing: undefined },
		never,
		string,
		{ attempt: Attempt },
		WorkspaceCreationResult<Draft, Workspace>
	>({
		actors,
		guards: {
			cancelling: stateIn({ running: { control: 'cancelling' } }),
			closing: stateIn({ running: { control: 'closing' } })
		}
	})
	const fail = (error: unknown, unresolved = false): Outcome => ({
		outcome: 'failed',
		error,
		settlement: unresolved ? { kind: 'unresolved', error } : { kind: 'notStarted' }
	})
	const transactionInput = ({ context }: { context: FullContext }) => ({
		custody: context.custody,
		transaction: required(context.transaction),
		attempt: context.attempt
	})
	const interrupt = [
		{ guard: 'closing', target: 'rollingBack' },
		{ guard: 'cancelling', target: 'rollingBack' }
	] satisfies { guard: 'closing' | 'cancelling'; target: string }[]
	return model.createMachine({
		id: 'workspace-creation-transaction',
		context: ({ input }) => ({
			custody: createTransactionCustody(capability.retainDetached),
			attempt: input.attempt,
			transaction: undefined,
			records: undefined,
			workspace: undefined,
			write: undefined,
			result: undefined
		}),
		initial: 'running',
		output: ({ context }) => ({ ...required(context.result), attempt: context.attempt }),
		states: {
			running: {
				type: 'parallel',
				invoke: {
					src: 'custodian',
					input: ({ context, self }) => ({ custody: context.custody, owner: self }),
					onError: {
						actions: () => {
							throw new Error('Transaction custody failed')
						}
					}
				},
				states: {
					control: {
						initial: 'active',
						states: {
							active: { on: { CANCEL: 'cancelling', SHUTDOWN: 'closing' } },
							cancelling: { on: { CANCEL: {}, SHUTDOWN: 'closing' } },
							closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
						}
					},
					work: {
						initial: 'opening',
						states: {
							opening: {
								invoke: {
									src: 'open',
									input: ({ context }) => ({ custody: context.custody }),
									onDone: {
										target: 'checkingAfterOpen',
										actions: assign({ transaction: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({ result: ({ event }) => fail(event.error) })
									}
								}
							},
							checkingAfterOpen: { always: [...interrupt, { target: 'readingLocal' }] },
							readingLocal: {
								invoke: {
									src: 'read',
									input: transactionInput,
									onDone: {
										target: 'checkingAfterRead',
										actions: assign({ records: ({ event }) => event.output })
									},
									onError: {
										target: 'rollingBack',
										actions: assign({ result: ({ event }) => fail(event.error) })
									}
								}
							},
							checkingAfterRead: { always: [...interrupt, { target: 'assessing' }] },
							assessing: {
								invoke: {
									src: 'assess',
									input: ({ context }) => ({
										records: required(context.records),
										attempt: context.attempt
									}),
									onDone: [
										...interrupt,
										{
											guard: ({ event }) => event.output.outcome === 'eligible',
											target: 'staging'
										},
										{
											target: 'rollingBack',
											actions: assign({
												result: ({ event }): Outcome => {
													const assessment: WorkspaceCreationAssessment = event.output
													if (assessment.outcome !== 'blocked')
														throw new Error('Expected blocked creation')
													return {
														outcome: 'blocked',
														reason: assessment.reason,
														settlement: { kind: 'notStarted' }
													}
												}
											})
										}
									],
									onError: {
										target: 'rollingBack',
										actions: assign({ result: ({ event }) => fail(event.error) })
									}
								}
							},
							staging: {
								invoke: {
									src: 'stage',
									input: transactionInput,
									onDone: {
										target: 'checkingBeforeCommit',
										actions: assign({ workspace: ({ event }) => event.output })
									},
									onError: {
										target: 'rollingBack',
										actions: assign({ result: ({ event }) => fail(event.error) })
									}
								}
							},
							checkingBeforeCommit: { always: [...interrupt, { target: 'committing' }] },
							committing: {
								invoke: {
									src: 'commit',
									input: ({ context }) => ({
										transaction: required(context.transaction),
										custody: context.custody
									}),
									onDone: {
										target: 'persistingLocal',
										actions: assign({ write: ({ event }) => event.output })
									},
									onError: {
										target: 'rollingBack',
										actions: assign({ result: ({ event }) => fail(event.error, true) })
									}
								}
							},
							persistingLocal: {
								invoke: {
									src: 'persist',
									input: ({ context }) => ({
										write: required(context.write),
										custody: context.custody
									}),
									onDone: {
										target: 'finishing',
										actions: [
											({ context }) => clearTransactionCustody(context.custody),
											assign({
												result: ({ context }): Outcome => ({
													outcome: 'succeeded',
													settlement: {
														kind: 'locallyPersisted',
														workspace: required(context.workspace)
													}
												})
											})
										]
									},
									onError: {
										target: 'rollingBack',
										actions: assign({ result: ({ event }) => fail(event.error, true) })
									}
								}
							},
							rollingBack: {
								invoke: {
									src: 'rollback',
									input: ({ context }) => ({
										transaction: required(context.transaction),
										custody: context.custody
									}),
									onDone: [
										{
											guard: ({ context, event }) =>
												event.output && context.result?.settlement.kind !== 'unresolved',
											target: 'finishing',
											actions: ({ context }) => clearTransactionCustody(context.custody)
										},
										{ guard: ({ event }) => event.output, target: 'finishing' },
										{
											target: 'finishing',
											actions: assign({
												result: () => fail(new Error('Workspace rollback not confirmed'), true)
											})
										}
									],
									onError: {
										target: 'finishing',
										actions: assign({ result: ({ event }) => fail(event.error, true) })
									}
								}
							},
							finishing: {
								always: [
									{ guard: 'closing', target: '#workspace-creation-transaction.closed' },
									{ guard: 'cancelling', target: '#workspace-creation-transaction.cancelled' },
									{ target: '#workspace-creation-transaction.completed' }
								]
							}
						}
					}
				}
			},
			completed: {
				always: [
					{ guard: ({ context }) => context.result?.outcome === 'succeeded', target: 'succeeded' },
					{ guard: ({ context }) => context.result?.outcome === 'blocked', target: 'blocked' },
					{ target: 'failed' }
				]
			},
			succeeded: { type: 'final' },
			blocked: { type: 'final' },
			failed: { type: 'final' },
			cancelled: {
				type: 'final',
				entry: assign({
					result: ({ context }): Outcome => ({
						outcome: 'cancelled',
						settlement: context.result?.settlement ?? { kind: 'notStarted' }
					})
				})
			},
			closed: {
				type: 'final',
				entry: assign({
					result: ({ context }): Outcome => ({
						outcome: 'closed',
						settlement: context.result?.settlement ?? { kind: 'notStarted' }
					})
				})
			}
		}
	})
}
