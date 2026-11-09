import { types, createAsyncLogic, setup, type ActorLogic, type Snapshot } from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
export type InitializationEvent =
	| {
			type: 'CANCEL'
	  }
	| {
			type: 'SHUTDOWN'
	  }
export type InitializationRecords = {
	identities: readonly {
		id: string
		initialWorkspaceId?: string | null | undefined
	}[]
	workspaces: readonly unknown[]
	serverConfigured: boolean
}
export type InitializationOutcome<Persistence> =
	| Persistence
	| {
			outcome: 'ready'
			identityId: string
			workspaceId: string
	  }
	| {
			outcome: 'unavailable'
			reason:
				| 'authorityUnavailable'
				| 'initializationMissing'
				| 'identityMissing'
				| 'duplicateIdentities'
	  }
	| {
			outcome: 'failed'
			settlement: 'notStarted' | 'unresolved'
			error: unknown
	  }
	| {
			outcome: 'closed' | 'cancelled'
			settlement: 'notStarted'
	  }
export type BootstrapLogic<Db, Attempt, S extends Snapshot<unknown>> = ActorLogic<
	S,
	InitializationEvent,
	{
		db: Db
		attempt: Attempt
		purpose?: 'additional' | 'bootstrap'
	}
>
export function createWorkspaceInitialization<
	Db,
	Tier,
	Attempt,
	Persistence extends {
		outcome: string
	},
	S extends Snapshot<Persistence>
>(options: {
	tiers: {
		local: Tier
		authority: Tier
	}
	discover: (input: { db: Db; userId: string; tier: Tier }) => Promise<InitializationRecords>
	prepareInitial: (input: { db: Db; userId: string }) => Promise<Attempt>
	selectReady: (attempt: Attempt) => {
		identityId: string
		workspaceId: string
	}
	transaction: BootstrapLogic<Db, Attempt, S>
}) {
	type Input = {
		db: Db
		userId: string
	}
	type Records = InitializationRecords
	type WorkspaceCreationAttempt = Attempt
	type WorkspacePersistenceEvent = InitializationEvent
	type WorkspaceInitializationResult = InitializationOutcome<Persistence>
	const discover = createAsyncLogic({
		run: async ({
			input
		}: {
			input: Input & {
				tier: Tier
			}
		}) => options.discover(input)
	})
	const prepareInitial = createAsyncLogic({
		run: async ({ input }: { input: Input }) => options.prepareInitial(input)
	})
	type Context = Input & {
		records: Records | undefined
		attempt: WorkspaceCreationAttempt | undefined
		result: WorkspaceInitializationResult | undefined
	}
	function required<T>(value: T | undefined): T {
		if (value === undefined) throw new Error('Missing workspace initialization observation')
		return value
	}
	/** Initialization provenance is independent of the active workspace/route. No writes on empty cache alone. */
	const completionModel = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<WorkspacePersistenceEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<WorkspacePersistenceEvent, 'SHUTDOWN'>>()
			},
			input: types<Input>(),
			output: types<WorkspaceInitializationResult>()
		},
		actors: {
			discover,
			prepareInitial,
			transaction: options.transaction
		}
	})
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof completionModel.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		ready: (args, _enq) => {
			const { context } = args
			return {
				context: {
					result: {
						outcome: 'ready',
						...(context.attempt !== undefined
							? options.selectReady(context.attempt)
							: {
									identityId: required(context.records?.identities[0]).id,
									workspaceId: required(
										required(context.records?.identities[0]).initialWorkspaceId ?? undefined
									)
								})
					}
				} satisfies Partial<Context>
			}
		},
		duplicateIdentities: (_args, _enq) => {
			return {
				context: {
					result: {
						outcome: 'unavailable',
						reason: 'duplicateIdentities'
					}
				} satisfies Partial<Context>
			}
		},
		identityMissing: (_args, _enq) => {
			return {
				context: {
					result: {
						outcome: 'unavailable',
						reason: 'identityMissing'
					}
				} satisfies Partial<Context>
			}
		},
		authorityUnavailable: (_args, _enq) => {
			return {
				context: {
					result: {
						outcome: 'unavailable',
						reason: 'authorityUnavailable'
					}
				} satisfies Partial<Context>
			}
		},
		initializationMissing: (_args, _enq) => {
			return {
				context: {
					result: {
						outcome: 'unavailable',
						reason: 'initializationMissing'
					}
				} satisfies Partial<Context>
			}
		},
		cancelled: (_args, _enq) => {
			return {
				context: {
					result: {
						outcome: 'cancelled',
						settlement: 'notStarted'
					}
				} satisfies Partial<Context>
			}
		},
		closed: (_args, _enq) => {
			return {
				context: {
					result: {
						outcome: 'closed',
						settlement: 'notStarted'
					}
				} satisfies Partial<Context>
			}
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>
	const complete = createFinalTransitions<
		Context,
		CompletionArgs,
		CompletionQueue,
		keyof typeof finalizers
	>(finalizers)

	const machine = completionModel.createMachine({
		id: 'workspace-initialization',
		context: ({ input }) => ({
			...input,
			records: undefined,
			attempt: undefined,
			result: undefined
		}),
		initial: 'readingLocal',
		output: ({ context }) => required(context.result),
		on: {
			CANCEL: (args, enq) => {
				return complete('cancelled', args, enq, { target: '.cancelled' })
			},
			SHUTDOWN: (args, enq) => {
				return complete('closed', args, enq, { target: '.closed' })
			}
		},
		states: {
			readingLocal: {
				invoke: completionModel.createInvoke<typeof discover, Context>({
					src: discover,
					input: ({ context }) => ({
						db: context.db,
						userId: context.userId,
						tier: options.tiers.local
					}),
					onDone: (args) => {
						return {
							target: 'checkingIdentities',
							context: { records: args.event.output } satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'failed',
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
			checkingIdentities: {
				always: (args, enq) => {
					if ((args.context.records?.identities.length ?? 0) > 1) {
						{
							return complete('duplicateIdentities', args, enq, { target: 'duplicateIdentities' })
						}
					}
					return { target: 'checkingInitialization' }
				}
			},
			checkingInitialization: {
				always: (args, enq) => {
					if (args.context.records?.identities[0]?.initialWorkspaceId != null) {
						{
							return complete('ready', args, enq, { target: 'ready' })
						}
					}
					return { target: 'checkingAuthority' }
				}
			},
			checkingAuthority: {
				always: (args, enq) => {
					if (args.context.records?.serverConfigured === true) {
						return { target: 'awaitingAuthority' }
					}
					{
						return complete('authorityUnavailable', args, enq, { target: 'authorityUnavailable' })
					}
				}
			},
			awaitingAuthority: {
				// Remote waits offline; no timeout or empty local result authorizes bootstrap.
				invoke: completionModel.createInvoke<typeof discover, Context>({
					src: discover,
					input: ({ context }) => ({
						db: context.db,
						userId: context.userId,
						tier: options.tiers.authority
					}),
					onDone: (args) => {
						return {
							target: 'checkingAuthoritativeIdentities',
							context: { records: args.event.output } satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'failed',
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
			checkingAuthoritativeIdentities: {
				always: (args, enq) => {
					const { context } = args
					if ((context.records?.identities.length ?? 0) > 1) {
						{
							return complete('duplicateIdentities', args, enq, { target: 'duplicateIdentities' })
						}
					}
					if (context.records?.identities[0]?.initialWorkspaceId != null) {
						{
							return complete('ready', args, enq, { target: 'ready' })
						}
					}
					if (context.records?.identities.length === 1) {
						{
							return complete('initializationMissing', args, enq, {
								target: 'initializationMissing'
							})
						}
					}
					if ((context.records?.workspaces.length ?? 0) > 0) {
						{
							return complete('identityMissing', args, enq, { target: 'identityMissing' })
						}
					}
					return { target: 'preparingInitial' }
				}
			},
			preparingInitial: {
				invoke: completionModel.createInvoke<typeof prepareInitial, Context>({
					src: prepareInitial,
					input: ({ context }) => context,
					onDone: (args) => {
						return {
							target: 'bootstrapping',
							context: { attempt: args.event.output } satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'failed',
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
			bootstrapping: {
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('bootstrap', { type: 'CANCEL' })
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('bootstrap', { type: 'SHUTDOWN' })
					}
				},
				invoke: completionModel.createInvoke<typeof options.transaction, Context>({
					id: 'bootstrap',
					src: options.transaction,
					input: ({ context }) => ({
						db: context.db,
						attempt: required(context.attempt),
						purpose: 'bootstrap'
					}),
					onDone: (args, enq) => {
						const { event } = args
						if (event.output?.outcome === 'succeeded') {
							{
								return complete('ready', args, enq, { target: 'ready' })
							}
						}
						return {
							target: 'completed',
							context: { result: event.output } satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'failed',
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
			ready: {
				type: 'final'
			},
			duplicateIdentities: {
				type: 'final'
			},
			identityMissing: {
				type: 'final'
			},
			authorityUnavailable: {
				type: 'final'
			},
			initializationMissing: {
				type: 'final'
			},
			cancelled: {
				type: 'final'
			},
			closed: {
				type: 'final'
			},
			failed: { type: 'final' },
			completed: { type: 'final' }
		}
	})
	return machine
}
