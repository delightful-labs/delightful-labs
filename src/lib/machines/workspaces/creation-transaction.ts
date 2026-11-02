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
	type Context = {
		attempt: Attempt
		transaction: Transaction | undefined
		workspace: Workspace | undefined
		write: Write | undefined
		result: Outcome | undefined
	}
	const actors = {
		open: fromPromise(async () => capability.open()),
		read: fromPromise(
			async ({ input }: { input: { transaction: Transaction; attempt: Attempt } }) =>
				capability.readLocal(input.transaction, input.attempt)
		),
		assess: fromPromise(async ({ input }: { input: { records: Records; attempt: Attempt } }) =>
			capability.assess(input.records, input.attempt)
		),
		stage: fromPromise(
			async ({ input }: { input: { transaction: Transaction; attempt: Attempt } }) =>
				capability.stage(input.transaction, input.attempt)
		),
		commit: fromPromise(async ({ input }: { input: { transaction: Transaction } }) =>
			capability.commit(input.transaction)
		),
		persist: fromPromise(async ({ input }: { input: { write: Write } }) =>
			capability.persistLocal(input.write)
		),
		rollback: fromPromise(async ({ input }: { input: { transaction: Transaction } }) =>
			capability.rollback(input.transaction)
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
									input: ({ context }) => ({ transaction: required(context.transaction) }),
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
									input: ({ context }) => ({ write: required(context.write) }),
									onDone: {
										target: 'finishing',
										actions: assign({
											result: ({ context }): Outcome => ({
												outcome: 'succeeded',
												settlement: {
													kind: 'locallyPersisted',
													workspace: required(context.workspace)
												}
											})
										})
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
									input: ({ context }) => ({ transaction: required(context.transaction) }),
									onDone: [
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
