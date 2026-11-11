import { PUBLIC_FAKE_DATA } from '$app/env/public'
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
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof fakeDataSetup>>
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

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
				if (PUBLIC_FAKE_DATA === 'true') {
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
