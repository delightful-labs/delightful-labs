import { app } from '#lib/schema.js'
import type { CredentialScope } from '#lib/validation/integrations.js'
import type { Connection, Dependencies } from './types.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type SetupBaseline = {
	scope: CredentialScope
	baselineCiphertext: string | null
	baselineStatus: Connection['status'] | null
}
type Context = SetupBaseline & { current: Connection | undefined; error: unknown }

export function createSetupBaselineMachine({ db }: Dependencies) {
	const actors = {
		connection: createAsyncLogic({
			run: ({ input }: { input: SetupBaseline }) =>
				db.all(app.simplefinConnections.where({ id: input.scope.connectionId }))
		})
	}
	const events0 = { CHECK: types<EventPayload<{ type: 'CHECK' }, 'CHECK'>>() }
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<(typeof actors)['connection']>>
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<SetupBaseline>(),
			output: types<{ error: unknown }>(),
			children: {
				connection: types<import('xstate').ActorRefFrom<(typeof actors)['connection']>>()
			}
		},
		actors
	}).createMachine({
		id: 'bank-setup-baseline',
		context: ({ input }) => ({ ...input, current: undefined, error: undefined }),
		initial: 'loadingConnection',
		output: ({ context }) => ({ error: context.error }),
		states: {
			loadingConnection: {
				invoke: {
					src: 'connection',
					input: ({ context }) => context,
					onDone: (args) => {
						return { target: 'checkingCiphertext', context: { current: args.event.output[0] } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			checkingCiphertext: {
				always: (args) => {
					const { context } = args
					if ((context.current?.ciphertext ?? null) !== context.baselineCiphertext) {
						return { target: 'changed' }
					}
					return { target: 'checkingStatus' }
				}
			},
			checkingStatus: {
				always: (args) => {
					const { context } = args
					if ((context.current?.status ?? null) !== context.baselineStatus) {
						return { target: 'changed' }
					}
					return { target: 'unchanged' }
				}
			},
			unchanged: { type: 'final' },
			changed: {
				type: 'final',
				entry: () => {
					return { context: { error: new Error('disconnected') } }
				}
			},
			failed: { type: 'final' }
		}
	})
}
