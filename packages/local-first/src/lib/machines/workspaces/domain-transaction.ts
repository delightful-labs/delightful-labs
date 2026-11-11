import type { EventPayload } from '../../contracts/machine-events.js'
import { types, setup, matchesState } from 'xstate'

import { createWorkspaceCreationTransaction } from './creation-transaction.js'
import type {
	WorkspaceCreationAssessment,
	WorkspaceCreationAttempt,
	WorkspaceCreationResult
} from '../../contracts/workspace-creation.js'
import type {
	DomainTransactionLifecycle,
	TransactionDomainChild,
	TransactionDomainSpawner
} from '../../contracts/domain-transaction.js'

type Reply<T> = { resolve: (value: T) => void; reject: (error: unknown) => void }
type ReadRequest<Resource> = {
	type: 'READ'
	resource: Resource
	reply: Reply<WorkspaceCreationAssessment>
}
type StageRequest<Receipt> = { type: 'STAGE'; reply: Reply<Receipt> }
type Prepared = { type: 'PREPARED'; assessment: WorkspaceCreationAssessment }
type Event<Resource, Receipt> =
	| ReadRequest<Resource>
	| StageRequest<Receipt>
	| Prepared
	| { type: 'CANCEL' | 'SHUTDOWN' }
type TransactionPort<Resource, Receipt> = {
	send: (event: ReadRequest<Resource> | StageRequest<Receipt>) => void
}
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transaction domain resource')
	return value
}
function requestRead<Resource, Receipt>(
	owner: TransactionPort<Resource, Receipt>,
	resource: Resource
) {
	return new Promise<WorkspaceCreationAssessment>((resolve, reject) =>
		owner.send({
			type: 'READ',
			resource,
			reply: { resolve, reject }
		} satisfies ReadRequest<Resource>)
	)
}
function requestStage<Receipt>(owner: { send: (event: StageRequest<Receipt>) => void }) {
	return new Promise<Receipt>((resolve, reject) =>
		owner.send({ type: 'STAGE', reply: { resolve, reject } } satisfies StageRequest<Receipt>)
	)
}

/** DLF alone acquires, commits, drains and rolls back the transaction. The invoked
 * domain chart owns facts, guards and mutations; messages cross the callback API
 * without storing domain state on an imperative transaction handle. */
function createDomainTransactionController<Draft, Resource, Write, Receipt>(
	spawnDomain: TransactionDomainSpawner<Draft, Resource, Receipt>,
	lifecycle: DomainTransactionLifecycle<Resource, Write>
) {
	type Attempt = WorkspaceCreationAttempt<Draft>
	type Context = {
		domain: TransactionDomainChild<Receipt> | undefined
		record: {
			attempt: Attempt
			resource: Resource | undefined
			readReply: Reply<WorkspaceCreationAssessment> | undefined
			stageReply: Reply<Receipt> | undefined
			result: WorkspaceCreationResult<Draft, Receipt> | undefined
		}
	}
	const transaction = createWorkspaceCreationTransaction<
		{ request: Draft; domain: TransactionPort<Resource, Receipt> },
		Resource,
		WorkspaceCreationAssessment,
		Receipt,
		Write
	>({
		...lifecycle,
		readLocal: (resource, attempt) => requestRead(attempt.draft.domain, resource),
		assess: (assessment) => assessment,
		stage: (_resource, attempt) => requestStage(attempt.draft.domain)
	})
	const actors = { transaction }
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				STAGE: types<EventPayload<Event<Resource, Receipt>, 'STAGE'>>(),
				PREPARED: types<EventPayload<Event<Resource, Receipt>, 'PREPARED'>>(),
				SHUTDOWN: types<EventPayload<Event<Resource, Receipt>, 'SHUTDOWN'>>(),
				CANCEL: types<EventPayload<Event<Resource, Receipt>, 'CANCEL'>>(),
				READ: types<EventPayload<Event<Resource, Receipt>, 'READ'>>(),
				DOMAIN_DONE: types<{ receipt: Receipt }>()
			},
			input: types<{ attempt: Attempt }>(),
			output: types<WorkspaceCreationResult<Draft, Receipt>>(),
			tags: types<string>(),
			children: {
				transaction: types<import('xstate').ActorRefFrom<typeof transaction>>()
			}
		},
		actors,
		guards: {
			reading: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ running: { domain: { processing: 'reading' } } }, value)
		},
		actions: {
			acceptRead: (args: { context: Context }, params: ReadRequest<Resource>) => ({
				context: {
					record: {
						...args.context.record,
						resource: params.resource,
						readReply: params.reply
					}
				}
			}),
			acceptStage: (args: { context: Context }, params: StageRequest<Receipt>) => ({
				context: {
					record: {
						...args.context.record,
						stageReply: params.reply
					}
				}
			}),
			reportPrepared: ({ context }: { context: Context }, event: Prepared) =>
				required(context.record.readReply).resolve(event.assessment),
			reportStaged: ({ context }: { context: Context }, event: { receipt: Receipt }) =>
				required(context.record.stageReply).resolve(event.receipt),
			rejectRead: ({ context }: { context: Context }, event: { error: unknown }) =>
				required(context.record.readReply).reject(event.error),
			rejectStage: ({ context }: { context: Context }, event: { error: unknown }) =>
				required(context.record.stageReply).reject(event.error),
			finish: (
				args: { context: Context },
				params: {
					result: WorkspaceCreationResult<
						{ request: Draft; domain: TransactionPort<Resource, Receipt> },
						Receipt
					>
				}
			) => ({
				context: {
					record: {
						...args.context.record,
						result: { ...params.result, attempt: args.context.record.attempt }
					}
				}
			})
		}
	}).createMachine({
		id: 'domain-transaction',
		context: ({ input }) => ({
			domain: undefined,
			record: {
				attempt: input.attempt,
				resource: undefined,
				readReply: undefined,
				stageReply: undefined,
				result: undefined
			}
		}),
		initial: 'running',
		output: ({ context }) => required(context.record.result),
		states: {
			running: {
				type: 'parallel',
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('transaction', { type: 'CANCEL' })
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('transaction', { type: 'SHUTDOWN' })
					}
				},
				states: {
					transaction: {
						invoke: {
							id: 'transaction',
							src: 'transaction',
							input: ({ context, self }) => ({
								attempt: {
									...context.record.attempt,
									draft: { request: context.record.attempt.draft, domain: self }
								}
							}),
							onDone: (args) => {
								return {
									target: '#domain-transaction.completed',
									context: args.actions.finish(args, { result: args.event.output }).context
								}
							}
						}
					},
					domain: {
						initial: 'waiting',
						states: {
							waiting: {
								on: {
									READ: (args) => {
										const { event } = args
										return {
											target: 'processing',
											context: args.actions.acceptRead(args, event).context
										}
									}
								}
							},
							processing: {
								entry: (args, enq) => {
									const domain = spawnDomain(enq.spawn, {
										resource: required(args.context.record.resource),
										attempt: args.context.record.attempt,
										owner: args.self
									})
									enq.subscribeTo(domain, {
										done: (receipt) => ({ type: 'DOMAIN_DONE', receipt: required(receipt) })
									})
									return { context: { domain } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.domain)
									return { context: { domain: undefined } }
								},
								onError: (args, enq) => {
									if (args.guards.reading(args)) enq(args.actions.rejectRead, args, args.event)
									else enq(args.actions.rejectStage, args, args.event)
									return { target: 'failed' }
								},
								on: {
									DOMAIN_DONE: (args, enq) => {
										enq(args.actions.reportStaged, args, args.event)
										return { target: 'staged' }
									}
								},
								initial: 'reading',
								states: {
									reading: {
										on: {
											PREPARED: (args, enq) => {
												const { event } = args
												enq(args.actions.reportPrepared, args, event)
												return { target: 'awaitingStage' }
											}
										}
									},
									awaitingStage: {
										on: {
											STAGE: (args, enq) => {
												const { event } = args
												enq.sendTo(args.context.domain, { type: 'STAGE' })
												return {
													target: 'staging',
													context: args.actions.acceptStage(args, event).context
												}
											}
										}
									},
									staging: {}
								}
							},
							staged: {},
							failed: {}
						}
					}
				}
			},
			completed: { type: 'final' }
		}
	})
}

/** Expose only lifecycle commands to application actors. Read/stage protocol
 * events remain private to the invoked controller and its domain child. */
export function createDomainTransaction<Draft, Resource, Write, Receipt>(
	spawnDomain: TransactionDomainSpawner<Draft, Resource, Receipt>,
	lifecycle: DomainTransactionLifecycle<Resource, Write>
) {
	type Input = { attempt: WorkspaceCreationAttempt<Draft> }
	type Result = WorkspaceCreationResult<Draft, Receipt>
	type Context = { record: Input & { result: Result | undefined } }
	const actors = {
		workflow: createDomainTransactionController<Draft, Resource, Write, Receipt>(
			spawnDomain,
			lifecycle
		)
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				SHUTDOWN: types<EventPayload<{ type: 'CANCEL' | 'SHUTDOWN' }, 'SHUTDOWN'>>(),
				CANCEL: types<EventPayload<{ type: 'CANCEL' | 'SHUTDOWN' }, 'CANCEL'>>()
			},
			input: types<Input>(),
			output: types<Result>(),
			tags: types<string>(),
			children: { workflow: types<import('xstate').ActorRefFrom<typeof actors.workflow>>() }
		},
		actors,
		actions: {
			finish: (args: { context: Context }, params: { result: Result }) => ({
				context: {
					record: {
						...args.context.record,
						result: params.result
					}
				}
			})
		}
	}).createMachine({
		context: ({ input }) => ({ record: { ...input, result: undefined } }),
		initial: 'running',
		output: ({ context }) => required(context.record.result),
		states: {
			running: {
				invoke: {
					id: 'workflow',
					src: 'workflow',
					input: ({ context }: { context: Context }) => ({ attempt: context.record.attempt }),
					onDone: (args) => {
						return {
							target: 'done',
							context: args.actions.finish(args, { result: args.event.output }).context
						}
					}
				},
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('workflow', { type: 'CANCEL' })
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('workflow', { type: 'SHUTDOWN' })
					}
				}
			},
			done: { type: 'final' }
		}
	})
}
