import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { z } from 'zod'
import { app } from '../../schema.js'
import {
	workspaceIntegrityAssessment,
	type IntegrityAssessment,
	type IntegrityRecords,
	type IntegrityScope
} from './workspace-integrity-assessment.js'
import {
	workspaceIntegrityTransaction,
	type IntegrityEvent,
	type IntegrityResult
} from './workspace-integrity-transaction.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Db = Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction' | 'getConfig'>
type Input = IntegrityScope & { db: Db }
const prepare = createAsyncLogic({
	run: async ({ input }: { input: Input }) => {
		z.uuid().parse(input.userId)
		z.uuid().parse(input.profileId)
		z.uuid().parse(input.organizationId)
	}
})
const discover = createAsyncLogic({
	run: async ({
		input
	}: {
		input: Input & { tier: typeof ReadTier.LocalFirst | typeof ReadTier.Remote }
	}): Promise<IntegrityRecords> => {
		const { db, tier, organizationId, userId } = input
		const [profiles, organizations, memberships] = await Promise.all([
			db.all(app.profiles.where({ userId }), { tier }),
			db.all(app.organizations.where({ id: organizationId }), { tier }),
			db.all(app.organizationMembers.where({ organizationId, userId }), { tier })
		])
		return { profiles, organizations, memberships }
	}
})
type Context = Input & {
	records: IntegrityRecords | undefined
	assessment: IntegrityAssessment | undefined
	result: IntegrityResult | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing workspace integrity observation')
	return value
}
const events0 = {
	CANCEL: types<EventPayload<IntegrityEvent, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<IntegrityEvent, 'SHUTDOWN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<typeof prepare>
			| import('xstate').OutputFrom<typeof discover>
			| import('xstate').OutputFrom<typeof workspaceIntegrityAssessment>
			| import('xstate').OutputFrom<typeof workspaceIntegrityTransaction>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Fixed to one identity/workspace/database binding. Its owner must drain it before replacement. */
export const workspaceIntegrity = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<Input>(),
		output: types<IntegrityResult>(),
		children: {
			prepare: types<
				import('xstate').ActorRefFrom<
					{
						prepare: typeof prepare
						discover: typeof discover
						assess: typeof workspaceIntegrityAssessment
						transaction: typeof workspaceIntegrityTransaction
					}['prepare']
				>
			>(),
			discover: types<
				import('xstate').ActorRefFrom<
					{
						prepare: typeof prepare
						discover: typeof discover
						assess: typeof workspaceIntegrityAssessment
						transaction: typeof workspaceIntegrityTransaction
					}['discover']
				>
			>(),
			assess: types<
				import('xstate').ActorRefFrom<
					{
						prepare: typeof prepare
						discover: typeof discover
						assess: typeof workspaceIntegrityAssessment
						transaction: typeof workspaceIntegrityTransaction
					}['assess']
				>
			>(),
			transaction: types<
				import('xstate').ActorRefFrom<
					{
						prepare: typeof prepare
						discover: typeof discover
						assess: typeof workspaceIntegrityAssessment
						transaction: typeof workspaceIntegrityTransaction
					}['transaction']
				>
			>()
		}
	},
	actors: {
		prepare,
		discover,
		assess: workspaceIntegrityAssessment,
		transaction: workspaceIntegrityTransaction
	},
	guards: {
		closing: (args: { value: import('xstate').StateValue }) =>
			matchesState({ repairing: 'closing' }, args.value),
		cancelling: (args: { value: import('xstate').StateValue }) =>
			matchesState({ repairing: 'cancelling' }, args.value)
	}
}).createMachine({
	id: 'workspace-integrity',
	context: ({ input }) => ({
		...input,
		records: undefined,
		assessment: undefined,
		result: undefined
	}),
	initial: 'validatingScope',
	output: ({ context }) => required(context.result),
	on: { CANCEL: { target: '.cancelled' }, SHUTDOWN: { target: '.closed' } },
	states: {
		validatingScope: {
			invoke: {
				src: 'prepare',
				input: ({ context }) => context,
				onDone: { target: 'readingLocal' },
				onError: (args) => {
					return {
						target: 'failed',
						context: {
							result: {
								outcome: 'failed',
								settlement: 'notStarted',
								error: args.event.error
							}
						}
					}
				}
			}
		},
		readingLocal: {
			invoke: {
				src: 'discover',
				input: ({ context }) => ({ ...context, tier: ReadTier.LocalFirst }),
				onDone: (args) => {
					return { target: 'assessingLocal', context: { records: args.event.output } }
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
						}
					}
				}
			}
		},
		assessingLocal: {
			invoke: {
				src: 'assess',
				input: ({ context }) => ({ ...context, records: required(context.records) }),
				onDone: (args) => {
					return { target: 'choosingLocal', context: { assessment: args.event.output } }
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
						}
					}
				}
			}
		},
		choosingLocal: {
			always: (args) => {
				if (args.context.assessment?.outcome === 'repair') {
					return { target: 'checkingAuthority' }
				}
				return { target: 'acceptingAssessment' }
			}
		},
		checkingAuthority: {
			always: (args) => {
				const { context } = args
				if (Boolean(context.db.getConfig().serverUrl)) {
					return { target: 'awaitingAuthority' }
				}
				return {
					target: 'partial',
					context: {
						result: (({ context }): IntegrityResult => {
							const assessment = required(context.assessment)
							if (assessment.outcome !== 'repair') throw new Error('Expected suspected repair')

							return {
								outcome: 'partial',
								settlement: 'notStarted',
								issues: ['profileLink']
							}
						})(args)
					}
				}
			}
		},
		awaitingAuthority: {
			invoke: {
				src: 'discover',
				input: ({ context }) => ({ ...context, tier: ReadTier.Remote }),
				onDone: (args) => {
					return { target: 'assessingAuthority', context: { records: args.event.output } }
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
						}
					}
				}
			}
		},
		assessingAuthority: {
			invoke: {
				src: 'assess',
				input: ({ context }) => ({ ...context, records: required(context.records) }),
				onDone: (args) => {
					return { target: 'choosingAuthority', context: { assessment: args.event.output } }
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
						}
					}
				}
			}
		},
		choosingAuthority: {
			always: (args) => {
				if (args.context.assessment?.outcome === 'repair') {
					return { target: 'repairing' }
				}
				return { target: 'acceptingAssessment' }
			}
		},
		acceptingAssessment: {
			entry: (args) => {
				return {
					context: {
						result: (({ context }): IntegrityResult => {
							const assessment = required(context.assessment)
							if (assessment.outcome === 'repair') throw new Error('Expected terminal assessment')
							return { ...assessment, settlement: 'notStarted' }
						})(args)
					}
				}
			},
			always: { target: 'finishing' }
		},
		repairing: {
			initial: 'active',
			on: {
				CANCEL: (args, enq) => {
					enq.sendTo('transaction', { type: 'CANCEL' })
					return { target: '.cancelling' }
				},
				SHUTDOWN: (args, enq) => {
					enq.sendTo('transaction', { type: 'SHUTDOWN' })
					return { target: '.closing' }
				}
			},
			states: {
				active: {},
				cancelling: { on: { CANCEL: {} } },
				closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
			},
			invoke: {
				id: 'transaction',
				src: 'transaction',
				input: ({ context }) => {
					const assessment = required(context.assessment)
					if (assessment.outcome !== 'repair') throw new Error('Expected authorized repair')
					return { ...context, expected: assessment.plan }
				},
				onDone: (args) => {
					const { event } = args
					if (args.guards.closing(args)) {
						return { target: 'closed', context: { result: event.output } }
					}
					if (args.guards.cancelling(args)) {
						return { target: 'cancelled', context: { result: event.output } }
					}
					return { target: 'finishing', context: { result: event.output } }
				},
				onError: (args) => {
					const { event } = args
					if (args.guards.closing(args)) {
						return {
							target: 'closed',
							context: {
								result: {
									outcome: 'failed',
									settlement: 'unresolved',
									error: event.error
								}
							}
						}
					}
					if (args.guards.cancelling(args)) {
						return {
							target: 'cancelled',
							context: {
								result: {
									outcome: 'failed',
									settlement: 'unresolved',
									error: event.error
								}
							}
						}
					}
					return {
						target: 'unresolved',
						context: {
							result: {
								outcome: 'failed',
								settlement: 'unresolved',
								error: event.error
							}
						}
					}
				}
			}
		},
		finishing: {
			always: (args) => {
				const { context } = args
				if (context.result?.outcome === 'complete') {
					return { target: 'complete' }
				}
				if (context.result?.outcome === 'partial') {
					return { target: 'partial' }
				}
				if (context.result?.outcome === 'unavailable') {
					return { target: 'unavailable' }
				}
				if (context.result?.outcome === 'conflict') {
					return { target: 'conflict' }
				}
				if (context.result?.outcome === 'cancelled') {
					return { target: 'cancelled' }
				}
				if (context.result?.outcome === 'closed') {
					return { target: 'closed' }
				}
				if (context.result?.settlement === 'unresolved') {
					return { target: 'unresolved' }
				}
				return { target: 'failed' }
			}
		},
		complete: { type: 'final' },
		partial: { type: 'final' },
		unavailable: { type: 'final' },
		conflict: { type: 'final' },
		failed: { type: 'final' },
		unresolved: { type: 'final' },
		cancelled: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						result: {
							outcome: 'cancelled',
							settlement: args.context.result?.settlement ?? 'notStarted'
						}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						result: {
							outcome: 'closed',
							settlement: args.context.result?.settlement ?? 'notStarted'
						}
					}
				}
			}
		}
	}
})
