import {
	matchesState,
	type StateValue,
	types,
	setup,
	type ActorRef,
	type ActorLogic,
	type Snapshot
} from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import {
	sameInitializationRequest,
	type InitializationRequest,
	type InitializationRecipient,
	type InitializationStatus,
	type InitializationStatusEvent as _InitializationStatusEvent
} from '../../contracts/workspace-startup.js'
export type StartupInitializationLogic<Db, S extends Snapshot<unknown>> = ActorLogic<
	S,
	| {
			type: 'CANCEL'
	  }
	| {
			type: 'SHUTDOWN'
	  },
	{
		db: Db
		userId: string
	}
>
export type StartupSeedLogic<Db, S extends Snapshot<unknown>> = ActorLogic<
	S,
	{
		type: 'CANCEL' | 'SHUTDOWN'
	},
	{
		db: Db
		userId: string
		organizationId: string
	}
>
// Own initialization and optional application seeding independently of foreground readiness.
export function createWorkspaceStartupMachine<
	Db,
	Initialization extends {
		outcome: string
	},
	Seed,
	IS extends Snapshot<Initialization>,
	SS extends Snapshot<Seed>
>(options: {
	db: Db
	initialize: StartupInitializationLogic<Db, IS>
	seed: StartupSeedLogic<Db, SS>
	ready: (result: Initialization | undefined) =>
		| {
				profileId: string
				organizationId: string
		  }
		| undefined
	initializationFailure: (error: unknown) => Initialization
	seedFailure: (error: unknown) => Seed
}) {
	type Input = {
		request: InitializationRequest
		recipient: InitializationRecipient
	}
	type Event =
		| {
				type: 'OBSERVED'
				request: InitializationRequest
		  }
		| {
				type: 'REEVALUATE' | 'SHUTDOWN'
		  }
		| {
				type: 'DRAIN_SEED' | 'REPLACE_SEED'
				actor:
					| ActorRef<
							SS,
							{
								type: 'CANCEL' | 'SHUTDOWN'
							}
					  >
					| undefined
		  }
	type Context = {
		request: InitializationRequest
		recipient: InitializationRecipient
		operation: InitializationRequest | undefined
		provenance:
			| {
					profileId: string
					organizationId: string
			  }
			| undefined
		results: {
			result: WorkspaceInitializationResult | undefined
			seedResult: WorkspaceFakeDataResult | undefined
		}
	}
	type WorkspaceInitializationResult = Initialization
	type WorkspaceFakeDataResult = Seed
	const db = options.db
	const workspaceInitialization = options.initialize
	const workspaceFakeData = options.seed
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				OBSERVED: types<EventPayload<Event, 'OBSERVED'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				REEVALUATE: types<EventPayload<Event, 'REEVALUATE'>>()
			},
			internalEvents: {
				DRAIN_SEED: types<EventPayload<Event, 'DRAIN_SEED'>>(),
				REPLACE_SEED: types<EventPayload<Event, 'REPLACE_SEED'>>()
			},
			input: types<Input>()
		},
		actors: { initialize: workspaceInitialization, seed: workspaceFakeData },
		guards: {
			closing: ({ value }: { value: StateValue }) =>
				matchesState({ initializing: 'closing' }, value),
			seedAlive: ({ event }: { event: Event }) =>
				(event.type === 'DRAIN_SEED' || event.type === 'REPLACE_SEED') &&
				event.actor?.getSnapshot().status === 'active',
			replacing: ({ value }: { value: StateValue }) =>
				matchesState({ initializing: 'replacing' }, value),
			identityChanged: ({ context }: { context: Context }) =>
				context.operation === undefined ||
				!sameInitializationRequest(context.request, context.operation)
		}
	})
	const report =
		(status: (context: Context) => InitializationStatus) =>
		({ context }: { context: Context }, enq: CompletionQueue) => {
			enq.sendTo(context.recipient, {
				type: 'INITIALIZATION_STATUS',
				report: { request: context.operation ?? context.request, status: status(context) }
			})
		}
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		closed: ({ context }, enq) => {
			enq.sendTo(context.recipient, {
				type: 'INITIALIZATION_STATUS',
				report: { request: context.operation ?? context.request, status: { kind: 'closed' } }
			})
		}
	} satisfies Record<
		string,
		(
			args: CompletionArgs,
			enq: CompletionQueue
		) => void | {
			context?: Partial<Context>
		}
	>

	return model.createMachine({
		id: 'workspace-startup',
		context: ({ input }) => ({
			request: input.request,
			recipient: input.recipient,
			operation: undefined,
			provenance: undefined,
			results: {
				result: undefined,
				seedResult: undefined
			}
		}),
		initial: 'checking',
		on: {
			OBSERVED: (args, enq) => {
				enq.raise({ type: 'REEVALUATE' })
				return {
					context: { request: args.event.request } satisfies Partial<Context>
				}
			},
			SHUTDOWN: (_args) => {
				return { target: '.closed' }
			}
		},
		states: {
			checking: {
				type: 'choice',
				choice: (args) => {
					const { context } = args
					if (context.request.status === 'ready' && !!context.request.userId) {
						return { target: 'initializing' }
					}
					return { target: 'waitingForSession' }
				}
			},
			waitingForSession: {
				entry: (args, enq) => {
					let context = args.context
					let patch: Partial<Context> = {}
					patch = {
						...patch,
						operation: undefined
					}
					context = { ...args.context, ...patch }
					report(() => ({ kind: 'waiting' }))({ ...args, context }, enq)
					return { context: patch satisfies Partial<Context> }
				},
				on: { REEVALUATE: { target: 'checking' } }
			},
			initializing: {
				initial: 'active',
				entry: (args, enq) => {
					let context = args.context
					let patch: Partial<Context> = {}
					patch = {
						...patch,
						operation: (({ context }: typeof args) => context.request)({
							...args,
							context
						}),
						provenance: undefined,
						results: {
							...context.results,
							result: undefined,
							seedResult: undefined
						}
					}
					context = { ...args.context, ...patch }
					report(() => ({ kind: 'checking' }))({ ...args, context }, enq)
					return { context: patch satisfies Partial<Context> }
				},
				on: {
					SHUTDOWN: (args, enq) => {
						enq.sendTo('initialize', { type: 'SHUTDOWN' })
						return { target: '.closing' }
					},
					REEVALUATE: (args, enq) => {
						if (!args.guards.identityChanged(args)) return
						enq.sendTo('initialize', { type: 'SHUTDOWN' })
						return { target: '.replacing' }
					}
				},
				states: {
					active: {},
					replacing: { entry: report(() => ({ kind: 'waiting' })), on: { REEVALUATE: {} } },
					closing: {
						entry: report(() => ({ kind: 'waiting' })),
						on: { REEVALUATE: {}, SHUTDOWN: {} }
					}
				},
				invoke: model.createInvoke<typeof workspaceInitialization, Context>({
					id: 'initialize',
					src: workspaceInitialization,
					input: ({ context }) => ({ db, userId: context.request.userId ?? '' }),
					onDone: (args) => {
						const { event } = args
						if (matchesState({ initializing: 'closing' }, args.value)) {
							return { target: 'closed' }
						}
						if (matchesState({ initializing: 'replacing' }, args.value)) {
							return { target: 'checking' }
						}
						return {
							target: 'admittingReady',
							context: {
								provenance: options.ready(event.output),
								results: {
									...args.context.results,
									result: event.output
								}
							} satisfies Partial<Context>
						}
					},
					onError: (args) => {
						if (matchesState({ initializing: 'closing' }, args.value)) {
							return { target: 'closed' }
						}
						if (matchesState({ initializing: 'replacing' }, args.value)) {
							return { target: 'checking' }
						}
						return {
							target: 'failed',
							context: {
								results: {
									...args.context.results,
									result: options.initializationFailure(args.event.error)
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			admittingReady: {
				type: 'choice',
				choice: (args) => {
					const { context } = args
					if (
						!!context.operation?.userId &&
						!!context.provenance?.profileId &&
						!!context.provenance.organizationId
					) {
						return { target: 'ready' }
					}
					return { target: 'failed' }
				}
			},
			ready: {
				initial: 'seeding',
				entry: report((context) =>
					context.provenance
						? { kind: 'ready', profileId: context.provenance.profileId }
						: { kind: 'failed' }
				),
				on: {
					REEVALUATE: (args, enq) => {
						if (!args.guards.identityChanged(args)) return
						enq.raise({
							type: 'REPLACE_SEED',
							actor: args.children.seed
						})
					},
					SHUTDOWN: (args, enq) => {
						enq.raise({
							type: 'DRAIN_SEED',
							actor: args.children.seed
						})
					},
					REPLACE_SEED: (args, enq) => {
						if (args.guards.seedAlive(args)) {
							enq.sendTo('seed', { type: 'SHUTDOWN' })
							return { target: '.replacing' }
						}
						if (args.guards.identityChanged(args)) {
							return { target: 'checking' }
						}
					},
					DRAIN_SEED: (args, enq) => {
						if (args.guards.seedAlive(args)) {
							enq.sendTo('seed', { type: 'SHUTDOWN' })
							return { target: '.closing' }
						}

						return { target: 'closed' }
					}
				},
				states: {
					seeding: { tags: ['workspace-ready'] },
					settled: { tags: ['workspace-ready'] },
					replacing: { entry: report(() => ({ kind: 'waiting' })), on: { REEVALUATE: {} } },
					closing: {
						entry: report(() => ({ kind: 'waiting' })),
						on: { REEVALUATE: {}, SHUTDOWN: {} }
					}
				},
				invoke: model.createInvoke<typeof workspaceFakeData, Context>({
					id: 'seed',
					src: workspaceFakeData,
					input: ({ context }) => ({
						db,
						userId: context.operation?.userId ?? '',
						organizationId: context.provenance?.organizationId ?? ''
					}),
					onDone: (args) => {
						const { event } = args
						if (matchesState({ ready: 'closing' }, args.value)) {
							return {
								target: 'closed',
								context: {
									results: {
										...args.context.results,
										seedResult: event.output
									}
								} satisfies Partial<Context>
							}
						}
						if (matchesState({ ready: 'replacing' }, args.value)) {
							return {
								target: 'checking',
								context: {
									results: {
										...args.context.results,
										seedResult: event.output
									}
								} satisfies Partial<Context>
							}
						}
						return {
							target: '.settled',
							context: {
								results: {
									...args.context.results,
									seedResult: event.output
								}
							} satisfies Partial<Context>
						}
					},
					onError: (args) => {
						if (matchesState({ ready: 'closing' }, args.value)) {
							return { target: 'closed' }
						}
						if (matchesState({ ready: 'replacing' }, args.value)) {
							return { target: 'checking' }
						}
						return {
							target: '.settled',
							context: {
								results: {
									...args.context.results,
									seedResult: options.seedFailure(args.event.error)
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			failed: {
				tags: ['workspace-error'],
				entry: report(() => ({ kind: 'failed' })),
				on: {
					REEVALUATE: (args) => {
						if (!args.guards.identityChanged(args)) return
						return { target: 'checking' }
					}
				}
			},
			closed: {
				type: 'final',
				entry: finalizers.closed
			}
		}
	})
}
