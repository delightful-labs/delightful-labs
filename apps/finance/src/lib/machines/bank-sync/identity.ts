import type { Dependencies, Observation, RequestIdentity } from './types.js'
import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Context = { identity: RequestIdentity; current: Observation; error: unknown }

// Invariant narrowing at typed actor boundaries; workflow decisions belong to guards.
export function required<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new Error('invalid-machine-context')
	return value
}

export function createIdentityMachine({ observe }: Dependencies) {
	const events0 = { CHECK: types<EventPayload<{ type: 'CHECK' }, 'CHECK'>>() }
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<RequestIdentity>(),
			output: types<{ current: Observation; error: unknown }>()
		}
	}).createMachine({
		id: 'bank-identity',
		context: ({ input }) => ({ identity: input, current: observe(), error: undefined }),
		initial: 'checkingSession',
		output: ({ context }) => ({ current: context.current, error: context.error }),
		states: {
			checkingSession: {
				always: (args) => {
					if (args.context.current.sessionReady) {
						return { target: 'checkingUser' }
					}
					return { target: 'denied' }
				}
			},
			checkingUser: {
				always: (args) => {
					if (Boolean(args.context.current.userId)) {
						return { target: 'checkingOrganization' }
					}
					return { target: 'denied' }
				}
			},
			checkingOrganization: {
				always: (args) => {
					if (Boolean(args.context.current.organizationId)) {
						return { target: 'checkingPermission' }
					}
					return { target: 'denied' }
				}
			},
			checkingPermission: {
				always: (args) => {
					if (args.context.current.allowed) {
						return { target: 'checkingRequestedUser' }
					}
					return { target: 'denied' }
				}
			},
			checkingRequestedUser: {
				always: (args) => {
					const { context } = args
					if (context.current.userId === context.identity.userId) {
						return { target: 'checkingRequestedOrganization' }
					}
					return { target: 'denied' }
				}
			},
			checkingRequestedOrganization: {
				always: (args) => {
					const { context } = args
					if (context.current.organizationId === context.identity.organizationId) {
						return { target: 'checkingConnection' }
					}
					return { target: 'denied' }
				}
			},
			checkingConnection: {
				always: (args) => {
					if (!args.context.current.connection) {
						return { target: 'authorized' }
					}
					return { target: 'checkingConnectionOwner' }
				}
			},
			checkingConnectionOwner: {
				always: (args) => {
					const { context } = args
					if (context.current.connection?.ownerId === context.current.userId) {
						return { target: 'checkingConnectionOrganization' }
					}
					return { target: 'denied' }
				}
			},
			checkingConnectionOrganization: {
				always: (args) => {
					const { context } = args
					if (context.current.connection?.organizationId === context.current.organizationId) {
						return { target: 'authorized' }
					}
					return { target: 'denied' }
				}
			},
			authorized: { type: 'final' },
			denied: {
				type: 'final',
				entry: () => {
					return { context: { error: new Error('unauthorized') } }
				}
			}
		}
	})
}
