import { types, createAsyncLogic, setup, type Snapshot } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	CreationChild,
	ReconciliationLogic,
	CreationEvent,
	CreationReconciliation,
	CreationPersistenceResult
} from './creation-operation.js'
export function createWorkspacePersistence<
	Db,
	Attempt,
	Workspace,
	RS extends Snapshot<CreationReconciliation<Workspace>>,
	TS extends Snapshot<CreationPersistenceResult<Workspace>>
>(options: {
	db: Db
	validate: (attempt: Attempt) => Promise<Attempt>
	reconcile: ReconciliationLogic<
		RS,
		{
			db: Db
			attempt: Attempt
		}
	>
	transaction: CreationChild<
		TS,
		{
			attempt: Attempt
		}
	>
}) {
	type WorkspacePersistenceEvent = CreationEvent
	type WorkspacePersistenceResult = CreationPersistenceResult<Workspace>
	type Input = {
		attempt: Attempt
		issuance: 'new' | 'unknown'
	}
	type Context = {
		issuance: 'new' | 'unknown'
		result: WorkspacePersistenceResult | undefined
		resources: {
			attempt: Attempt
			db: Db
		}
	}
	const db = options.db
	const transaction = options.transaction
	const validate = createAsyncLogic<
		Attempt,
		{
			attempt: Attempt
		}
	>({ run: ({ input }) => options.validate(input.attempt) })
	const invokeModel = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<WorkspacePersistenceEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<WorkspacePersistenceEvent, 'SHUTDOWN'>>()
			},
			input: types<Input>(),
			output: types<WorkspacePersistenceResult>()
		},
		actors: {
			validate,
			reconcile: options.reconcile,
			transaction
		}
	})
	return invokeModel.createMachine({
		id: 'workspace-creation-persistence',
		context: ({ input }) => ({
			issuance: input.issuance,
			result: undefined,
			resources: {
				attempt: input.attempt,
				db
			}
		}),
		initial: 'validating',
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing workspace persistence outcome')
			return context.result
		},
		on: { CANCEL: { target: '.cancelling' }, SHUTDOWN: { target: '.closing' } },
		states: {
			validating: {
				invoke: invokeModel.createInvoke<typeof validate, Context>({
					src: validate,
					input: ({ context }) => ({ attempt: context.resources.attempt }),
					onDone: (args) => {
						return {
							target: 'reconciling',
							context: {
								resources: {
									...args.context.resources,
									attempt: args.event.output
								}
							} satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'settling',
							context: {
								result: {
									outcome: 'failed',
									settlement: 'notStarted',
									error: args.event.error
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			reconciling: {
				invoke: invokeModel.createInvoke<typeof options.reconcile, Context>({
					src: options.reconcile,
					input: ({ context }) => ({
						db: context.resources.db,
						attempt: context.resources.attempt
					}),
					onDone: (args) => {
						const { event } = args
						if (
							event.output?.outcome === 'notStarted' ||
							(event.output?.outcome === 'absent' && args.context.issuance === 'new')
						) {
							return {
								target: 'transacting',
								context: { issuance: 'new' } satisfies Partial<Context>
							}
						}
						if (event.output?.outcome === 'absent') {
							return {
								target: 'settling',
								context: {
									result: {
										outcome: 'failed',
										settlement: 'unresolved',
										error: new Error('Prior creation issuance is unknown')
									}
								} satisfies Partial<Context>
							}
						}
						if (event.output?.outcome === 'matching') {
							return {
								target: 'settling',
								context: {
									result: (({ event }): WorkspacePersistenceResult => {
										if (event.output?.outcome !== 'matching')
											throw new Error('Expected matched workspace')
										return {
											outcome: 'succeeded',
											settlement: 'locallyPersisted',
											workspace: event.output?.workspace
										}
									})(args)
								} satisfies Partial<Context>
							}
						}
						if (event.output?.outcome === 'profileUnavailable') {
							return {
								target: 'settling',
								context: {
									result: { outcome: 'profileUnavailable', settlement: 'notStarted' }
								} satisfies Partial<Context>
							}
						}
						return {
							target: 'settling',
							context: {
								result: { outcome: 'conflict', settlement: 'notStarted' }
							} satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'settling',
							context: {
								result: {
									outcome: 'failed',
									settlement: 'notStarted',
									error: args.event.error
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			transacting: {
				// Forward interruption without exiting: the resource owner rolls back or drains its commit.
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('transaction', { type: 'CANCEL' })
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('transaction', { type: 'SHUTDOWN' })
					}
				},
				invoke: invokeModel.createInvoke<typeof transaction, Context>({
					id: 'transaction',
					src: transaction,
					input: ({ context }) => ({ attempt: context.resources.attempt }),
					onDone: (args) => {
						return {
							target: 'settling',
							context: { result: args.event.output } satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'settling',
							context: {
								result: {
									outcome: 'failed',
									settlement: 'unresolved',
									error: args.event.error
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			cancelling: {
				always: { target: 'settling' },
				entry: (_args) => {
					return {
						context: {
							result: {
								outcome: 'cancelled',
								settlement: 'notStarted'
							}
						} satisfies Partial<Context>
					}
				}
			},
			closing: {
				always: { target: 'settling' },
				entry: (_args) => {
					return {
						context: {
							result: {
								outcome: 'closed',
								settlement: 'notStarted'
							}
						} satisfies Partial<Context>
					}
				}
			},
			settling: {
				always: (args) => {
					const { context } = args
					if (context.issuance === 'unknown' && context.result?.settlement === 'notStarted') {
						return { target: 'unresolvedSettlement' }
					}
					if (context.result?.outcome === 'closed') {
						return { target: 'closed' }
					}
					if (context.result?.outcome === 'cancelled') {
						return { target: 'cancelled' }
					}
					if (context.result?.outcome === 'failed') {
						return { target: 'failed' }
					}
					return { target: 'completed' }
				}
			},
			unresolvedSettlement: {
				always: (args) => {
					const { context } = args
					if (context.result?.outcome === 'closed') {
						return {
							target: 'closed',
							context: {
								result: {
									outcome: 'closed',
									settlement: 'unresolved'
								}
							} satisfies Partial<Context>
						}
					}
					if (context.result?.outcome === 'cancelled') {
						return {
							target: 'cancelled',
							context: {
								result: {
									outcome: 'cancelled',
									settlement: 'unresolved'
								}
							} satisfies Partial<Context>
						}
					}
					return {
						target: 'failed',
						context: {
							result: {
								outcome: 'failed',
								settlement: 'unresolved',
								error: new Error('Prior creation issuance is unknown')
							}
						} satisfies Partial<Context>
					}
				}
			},
			closed: { type: 'final' },
			cancelled: { type: 'final' },
			completed: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
