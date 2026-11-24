import {
	matchesState,
	types,
	createAsyncLogic,
	setup,
	type ActorLogic,
	type Snapshot
} from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
export type InitializationEvent =
	| {
			type: 'CANCEL'
	  }
	| {
			type: 'SHUTDOWN'
	  }
export type InitializationRecords =
	| {
			canonicalRoot?: undefined
			identities: readonly {
				id: string
				initialWorkspaceId?: string | null | undefined
			}[]
			workspaces: readonly unknown[]
			serverConfigured: boolean
	  }
	| {
			/** Storage facts for a schema-enforced private root whose ID is the native identity. */
			canonicalRoot: {
				id: string
				status: 'compatible' | 'missing' | 'incompatible'
			}
			identities?: never
			workspaces?: never
			serverConfigured?: never
	  }
export type InitializationOutcome<Persistence> =
	| Persistence
	| {
			outcome: 'ready'
			identityId: string
			workspaceId: string
			/** Exact creation result; absent when opening existing local provenance/root. */
			persistence?: Persistence
	  }
	| {
			outcome: 'unavailable'
			reason:
				| 'authorityUnavailable'
				| 'initializationMissing'
				| 'identityMissing'
				| 'duplicateIdentities'
				| 'canonicalRootConflict'
	  }
	| {
			outcome: 'failed'
			settlement: 'notStarted' | 'unresolved'
			error: unknown
	  }
	| {
			outcome: 'closed' | 'cancelled'
			settlement: 'notStarted' | 'locallyPersisted' | 'rejected'
			persistence?: Persistence
	  }
export type BootstrapLogic<
	Db,
	Attempt,
	S extends Snapshot<unknown>,
	Events extends { type: string } = InitializationEvent
> = ActorLogic<
	S,
	Events | InitializationEvent,
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
	S extends Snapshot<Persistence>,
	Events extends { type: string } = InitializationEvent
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
	transaction: BootstrapLogic<Db, Attempt, S, Events>
	/** Only definitive concurrency outcomes permit one authority rediscovery. Never reissue a write. */
	reconcileBootstrap?: (
		persistence: NonNullable<S['output']>
	) => 'notStarted' | 'rejected' | undefined
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
	type Context = {
		userId: string
		records: Records | undefined
		operation: {
			db: Db
			attempt: WorkspaceCreationAttempt | undefined
			target: { identityId: string; workspaceId: string } | undefined
			persistence: Persistence | undefined
			reconciliation: 'notStarted' | 'rejected' | undefined
			result: WorkspaceInitializationResult | undefined
		}
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
			input: types<Input>()
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
		ready: (args) => {
			const { context } = args
			const canonical = context.records?.canonicalRoot
			const target =
				context.operation.target ??
				(canonical?.status === 'compatible'
					? { identityId: canonical.id, workspaceId: canonical.id }
					: {
							identityId: required(context.records?.identities?.[0]).id,
							workspaceId: required(
								required(context.records?.identities?.[0]).initialWorkspaceId ?? undefined
							)
						})
			return {
				context: {
					operation: {
						...args.context.operation,
						result: {
							outcome: 'ready',
							...target,
							...(context.operation.persistence !== undefined
								? { persistence: context.operation.persistence }
								: {})
						}
					}
				} satisfies Partial<Context>
			}
		},
		canonicalRootConflict: ({ context }) => ({
			context: {
				operation: {
					...context.operation,
					result: { outcome: 'unavailable', reason: 'canonicalRootConflict' }
				}
			} satisfies Partial<Context>
		}),
		duplicateIdentities: (_args) => {
			return {
				context: {
					operation: {
						..._args.context.operation,
						result: {
							outcome: 'unavailable',
							reason: 'duplicateIdentities'
						}
					}
				} satisfies Partial<Context>
			}
		},
		identityMissing: (_args) => {
			return {
				context: {
					operation: {
						..._args.context.operation,
						result: {
							outcome: 'unavailable',
							reason: 'identityMissing'
						}
					}
				} satisfies Partial<Context>
			}
		},
		authorityUnavailable: (_args) => {
			return {
				context: {
					operation: {
						..._args.context.operation,
						result: {
							outcome: 'unavailable',
							reason: 'authorityUnavailable'
						}
					}
				} satisfies Partial<Context>
			}
		},
		initializationMissing: (_args) => {
			return {
				context: {
					operation: {
						..._args.context.operation,
						result: {
							outcome: 'unavailable',
							reason: 'initializationMissing'
						}
					}
				} satisfies Partial<Context>
			}
		},
		cancelled: (_args) => {
			return {
				context: {
					operation: {
						..._args.context.operation,
						result: {
							outcome: 'cancelled',
							settlement: _args.context.operation.reconciliation ?? 'notStarted',
							...(_args.context.operation.persistence === undefined
								? {}
								: { persistence: _args.context.operation.persistence })
						}
					}
				} satisfies Partial<Context>
			}
		},
		closed: (_args) => {
			return {
				context: {
					operation: {
						..._args.context.operation,
						result: {
							outcome: 'closed',
							settlement: _args.context.operation.reconciliation ?? 'notStarted',
							...(_args.context.operation.persistence === undefined
								? {}
								: { persistence: _args.context.operation.persistence })
						}
					}
				} satisfies Partial<Context>
			}
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

	const machine = completionModel.createMachine({
		id: 'workspace-initialization',
		context: ({ input }) => ({
			userId: input.userId,
			records: undefined,
			operation: {
				db: input.db,
				attempt: undefined,
				target: undefined,
				persistence: undefined,
				reconciliation: undefined,
				result: undefined
			}
		}),
		initial: 'readingLocal',
		output: ({ context }): WorkspaceInitializationResult => required(context.operation.result),
		on: {
			CANCEL: (_args) => {
				return { target: '.cancelled' }
			},
			SHUTDOWN: (_args) => {
				return { target: '.closed' }
			}
		},
		states: {
			readingLocal: {
				invoke: completionModel.createInvoke<typeof discover, Context>({
					src: discover,
					input: ({ context }) => ({
						db: context.operation.db,
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
								operation: {
									...args.context.operation,
									result: {
										outcome: 'failed',
										settlement: 'notStarted',
										error: args.event.error
									}
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			checkingIdentities: {
				type: 'choice',
				choice: (args) => {
					const records = args.context.records
					const canonical = records?.canonicalRoot
					if (canonical) {
						if (
							!canonical.id ||
							canonical.id !== args.context.userId ||
							records.identities !== undefined ||
							records.workspaces !== undefined ||
							records.serverConfigured !== undefined ||
							canonical.status === 'incompatible'
						)
							return { target: 'canonicalRootConflict' }
						if (canonical.status === 'compatible') return { target: 'ready' }
						return { target: 'preparingInitial' }
					}
					if ((args.context.records?.identities?.length ?? 0) > 1) {
						return { target: 'duplicateIdentities' }
					}
					return { target: 'checkingInitialization' }
				}
			},
			checkingInitialization: {
				type: 'choice',
				choice: (args) => {
					if (args.context.records?.identities?.[0]?.initialWorkspaceId != null) {
						return { target: 'ready' }
					}
					return { target: 'checkingAuthority' }
				}
			},
			checkingAuthority: {
				always: (args) => {
					if (args.context.records?.serverConfigured === true) {
						return { target: 'awaitingAuthority' }
					}

					return { target: 'authorityUnavailable' }
				}
			},
			awaitingAuthority: {
				// Remote waits offline; no timeout or empty local result authorizes bootstrap.
				invoke: completionModel.createInvoke<typeof discover, Context>({
					src: discover,
					input: ({ context }) => ({
						db: context.operation.db,
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
								operation: {
									...args.context.operation,
									result: {
										outcome: 'failed',
										settlement: 'notStarted',
										error: args.event.error
									}
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			checkingAuthoritativeIdentities: {
				type: 'choice',
				choice: (args) => {
					const { context } = args
					if (context.records?.canonicalRoot) return { target: 'checkingIdentities' }
					if ((context.records?.identities?.length ?? 0) > 1) {
						return { target: 'duplicateIdentities' }
					}
					if (context.records?.identities?.[0]?.initialWorkspaceId != null) {
						return { target: 'ready' }
					}
					if (context.records?.identities?.length === 1) {
						return {
							target: 'initializationMissing'
						}
					}
					if ((context.records?.workspaces?.length ?? 0) > 0) {
						return { target: 'identityMissing' }
					}
					return { target: 'preparingInitial' }
				}
			},
			preparingInitial: {
				invoke: completionModel.createInvoke<typeof prepareInitial, Context>({
					src: prepareInitial,
					input: ({ context }) => ({ db: context.operation.db, userId: context.userId }),
					onDone: (args) => {
						const target = options.selectReady(args.event.output)
						const canonical = args.context.records?.canonicalRoot
						if (
							canonical &&
							(target.identityId !== canonical.id || target.workspaceId !== canonical.id)
						)
							return { target: 'canonicalRootConflict' }
						return {
							target: 'bootstrapping',
							context: {
								operation: {
									...args.context.operation,
									attempt: args.event.output,
									target
								}
							} satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'failed',
							context: {
								operation: {
									...args.context.operation,
									result: {
										outcome: 'failed',
										settlement: 'notStarted',
										error: args.event.error
									}
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			reconcilingBootstrap: {
				invoke: completionModel.createInvoke<typeof discover, Context>({
					src: discover,
					input: ({ context }) => ({
						db: context.operation.db,
						userId: context.userId,
						tier: options.tiers.authority
					}),
					onDone: ({ context, event }) => {
						const target = required(context.operation.target)
						const records = event.output
						const root = records.canonicalRoot
						const profile = records.identities?.[0]
						const matching = root
							? root.status === 'compatible' &&
								root.id === target.identityId &&
								root.id === target.workspaceId
							: records.identities?.length === 1 &&
								profile?.id === target.identityId &&
								profile.initialWorkspaceId === target.workspaceId
						return { target: matching ? 'ready' : 'completed', context: { records } }
					},
					onError: () => ({ target: 'completed' })
				})
			},
			bootstrapping: {
				initial: 'active',
				states: {
					active: {},
					cancelling: { on: { CANCEL: {} } },
					closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
				},
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('bootstrap', { type: 'CANCEL' })
						return { target: '.cancelling' }
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('bootstrap', { type: 'SHUTDOWN' })
						return { target: '.closing' }
					}
				},
				invoke: completionModel.createInvoke<typeof options.transaction, Context>({
					id: 'bootstrap',
					src: options.transaction,
					input: ({ context }) => ({
						db: context.operation.db,
						attempt: required(context.operation.attempt),
						purpose: 'bootstrap'
					}),
					onDone: (args) => {
						const { event } = args
						if (event.output?.outcome === 'succeeded') {
							if (
								matchesState({ bootstrapping: 'closing' }, args.value) ||
								matchesState({ bootstrapping: 'cancelling' }, args.value)
							)
								return {
									target: 'completed',
									context: {
										operation: {
											...args.context.operation,
											result: {
												outcome: matchesState({ bootstrapping: 'closing' }, args.value)
													? 'closed'
													: 'cancelled',
												settlement: 'locallyPersisted',
												persistence: event.output
											}
										}
									} satisfies Partial<Context>
								}
							return {
								target: 'ready',
								context: {
									operation: { ...args.context.operation, persistence: event.output }
								} satisfies Partial<Context>
							}
						}
						const reconciliation =
							event.output === undefined ||
							event.output === null ||
							!matchesState({ bootstrapping: 'active' }, args.value)
								? undefined
								: options.reconcileBootstrap?.(event.output)
						if (reconciliation !== undefined) {
							return {
								target: 'reconcilingBootstrap',
								context: {
									operation: {
										...args.context.operation,
										reconciliation,
										persistence: event.output,
										result: event.output
									}
								}
							}
						}
						return {
							target: 'completed',
							context: {
								operation: {
									...args.context.operation,
									result: event.output
								}
							} satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'failed',
							context: {
								operation: {
									...args.context.operation,
									result: {
										outcome: 'failed',
										settlement: 'unresolved',
										error: args.event.error
									}
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			ready: {
				type: 'final',
				entry: finalizers.ready
			},
			duplicateIdentities: {
				type: 'final',
				entry: finalizers.duplicateIdentities
			},
			canonicalRootConflict: {
				type: 'final',
				entry: finalizers.canonicalRootConflict
			},
			identityMissing: {
				type: 'final',
				entry: finalizers.identityMissing
			},
			authorityUnavailable: {
				type: 'final',
				entry: finalizers.authorityUnavailable
			},
			initializationMissing: {
				type: 'final',
				entry: finalizers.initializationMissing
			},
			cancelled: {
				type: 'final',
				entry: finalizers.cancelled
			},
			closed: {
				type: 'final',
				entry: finalizers.closed
			},
			failed: { type: 'final' },
			completed: { type: 'final' }
		}
	})
	return machine
}
