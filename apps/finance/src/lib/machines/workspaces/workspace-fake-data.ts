import { fakeDataSetup, type FakeDataDb, type FakeDataResult } from '../samples/fake-data.js'
import type { WorkspacePersistenceEvent } from './workspace-creation-transaction.js'
import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = {
	db: FakeDataDb
	userId: string
	organizationId: string
}
export type WorkspaceFakeDataResult = FakeDataResult
type Context = Input & { result: WorkspaceFakeDataResult | undefined }
const events0 = {
	CANCEL: types<EventPayload<WorkspacePersistenceEvent, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<WorkspacePersistenceEvent, 'SHUTDOWN'>>()
}

/** Own the feature gate and seed lifecycle; preserve the seed outcome and settlement for the startup owner. */
export const workspaceFakeData = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<Input>(),
		output: types<WorkspaceFakeDataResult>(),
		children: {
			seed: types<import('xstate').ActorRefFrom<{ seed: typeof fakeDataSetup }['seed']>>()
		}
	},
	actors: { seed: fakeDataSetup }
}).createMachine({
	id: 'workspace-fake-data',
	context: ({ input }) => ({ ...input, result: undefined }),
	initial: 'checking',
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing workspace fake-data result')
		return context.result
	},
	states: {
		checking: {
			always: () => {
				if (import.meta.env.PUBLIC_FAKE_DATA === 'true') {
					return { target: 'seeding' }
				}
				return { target: 'skipped' }
			}
		},
		seeding: {
			on: {
				CANCEL: (args, enq) => {
					enq.sendTo('seed', { type: 'CANCEL' })
				},
				SHUTDOWN: (args, enq) => {
					enq.sendTo('seed', { type: 'SHUTDOWN' })
				}
			},
			invoke: {
				id: 'seed',
				src: 'seed',
				input: ({ context }) => context,
				onDone: (args) => {
					const { event } = args
					if (event.output.outcome === 'seeded') {
						return { target: 'seeded', context: { result: event.output } }
					}
					if (event.output.outcome === 'skipped') {
						return { target: 'skipped', context: { result: event.output } }
					}
					if (event.output.outcome === 'cancelled') {
						return { target: 'cancelled', context: { result: event.output } }
					}
					if (event.output.outcome === 'closed') {
						return { target: 'closed', context: { result: event.output } }
					}
					return { target: 'failed', context: { result: event.output } }
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
						}
					}
				}
			}
		},
		seeded: { type: 'final' },
		skipped: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						result: args.context.result ?? { outcome: 'skipped', settlement: 'notStarted' }
					}
				}
			}
		},
		cancelled: { type: 'final' },
		closed: { type: 'final' },
		failed: { type: 'final' }
	}
})

/** One worker attachment; the existing seed chart owns every database effect. */
export const workerWorkspaceSeed = setup({
	schemas: {
		input: types<{ db: FakeDataDb; userId: string }>(),
		context: types<{
			db: FakeDataDb
			userId: string
			organizationId: string | undefined
			outcome: 'closed' | 'unresolved'
		}>(),
		output: types<{ outcome: 'closed' | 'unresolved' }>(),
		events: { INITIALIZED: types<{ workspaceId: string }>(), SHUTDOWN: types() },
		children: { seed: types<import('xstate').ActorRefFrom<typeof workspaceFakeData>>() }
	},
	actors: { seed: workspaceFakeData }
}).createMachine({
	id: 'finance-worker-optional-seed',
	context: ({ input }) => ({ ...input, organizationId: undefined, outcome: 'closed' }),
	initial: 'waiting',
	output: ({ context }) => ({ outcome: context.outcome }),
	states: {
		waiting: {
			on: {
				INITIALIZED: ({ event }) => ({
					target: 'running',
					context: { organizationId: event.workspaceId }
				}),
				SHUTDOWN: { target: 'closed' }
			}
		},
		running: {
			initial: 'seeding',
			invoke: {
				id: 'seed',
				src: 'seed',
				input: ({ context }) => ({ ...context, organizationId: context.organizationId ?? '' }),
				onDone: ({ event }) =>
					event.output.settlement === 'unresolved'
						? { target: 'closed', context: { outcome: 'unresolved' } }
						: { target: 'closed' },
				onError: { target: 'closed', context: { outcome: 'unresolved' } }
			},
			on: {
				INITIALIZED: {},
				SHUTDOWN: (_, enq) => {
					enq.sendTo('seed', { type: 'SHUTDOWN' })
					return { target: '.closing' }
				}
			},
			states: { seeding: {}, closing: { on: { SHUTDOWN: {} } } }
		},
		closed: { type: 'final' }
	}
})
