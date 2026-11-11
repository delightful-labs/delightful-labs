import { app } from '#lib/schema.js'
import { canManageBankCredentials } from '#lib/domain/organization-permissions.js'
import { stableUuid } from '#lib/data.js'
import { simplefinDemo } from '#lib/integrations/simplefin.js'
import { createIdentityMachine, required } from './identity.js'
import type { AuthorizationRequest, Connection, Dependencies } from './types.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Context = AuthorizationRequest & {
	demoId: string | undefined
	connection: Connection | undefined
	error: unknown
}

export function createAuthorizationMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		identity: createIdentityMachine(dependencies),
		membership: createAsyncLogic({
			run: ({ input }: { input: AuthorizationRequest }) =>
				db.all(
					app.organizationMembers.where({
						organizationId: input.scope.organizationId,
						userId: input.scope.ownerId
					})
				)
		}),
		demoId: createAsyncLogic({
			run: ({ input }: { input: AuthorizationRequest }) =>
				stableUuid(input.scope.ownerId, `simplefin-demo:${input.scope.organizationId}`)
		}),
		connections: createAsyncLogic({
			run: ({ input }: { input: AuthorizationRequest }) =>
				db.all(
					app.simplefinConnections.where({
						organizationId: input.scope.organizationId,
						ownerId: input.scope.ownerId
					})
				)
		}),
		connection: createAsyncLogic({
			run: ({ input }: { input: AuthorizationRequest }) =>
				db.all(
					app.simplefinConnections.where({
						id: input.scope.connectionId,
						ownerId: input.scope.ownerId,
						organizationId: input.scope.organizationId,
						status: 'active'
					})
				)
		})
	}
	const events0 = { CHECK: types<EventPayload<{ type: 'CHECK' }, 'CHECK'>>() }
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['identity']>
				| import('xstate').OutputFrom<(typeof actors)['membership']>
				| import('xstate').OutputFrom<(typeof actors)['demoId']>
				| import('xstate').OutputFrom<(typeof actors)['connections']>
				| import('xstate').OutputFrom<(typeof actors)['connection']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<AuthorizationRequest>(),
			output: types<{ error: unknown }>(),
			children: {
				identity: types<import('xstate').ActorRefFrom<(typeof actors)['identity']>>(),
				membership: types<import('xstate').ActorRefFrom<(typeof actors)['membership']>>(),
				demoId: types<import('xstate').ActorRefFrom<(typeof actors)['demoId']>>(),
				connections: types<import('xstate').ActorRefFrom<(typeof actors)['connections']>>(),
				connection: types<import('xstate').ActorRefFrom<(typeof actors)['connection']>>()
			}
		},
		actors
	}).createMachine({
		id: 'bank-authorization',
		context: ({ input }) => ({
			...input,
			demoId: undefined,
			connection: undefined,
			error: undefined
		}),
		initial: 'checkingIdentity',
		output: ({ context }) => ({ error: context.error }),
		states: {
			checkingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => ({
						userId: context.scope.ownerId,
						organizationId: context.scope.organizationId
					}),
					onDone: (args) => {
						if (args.event.output.error !== undefined) {
							return { target: 'unauthorized' }
						}
						return { target: 'loadingMembership' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			loadingMembership: {
				invoke: {
					src: 'membership',
					input: ({ context }) => context,
					onDone: (args) => {
						if (
							args.event.output.some((row) =>
								canManageBankCredentials(row, args.context.scope.organizationId)
							)
						) {
							return { target: 'generatingDemoId' }
						}
						return { target: 'unauthorized' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			generatingDemoId: {
				invoke: {
					src: 'demoId',
					input: ({ context }) => context,
					onDone: (args) => {
						return { target: 'checkingRequestedMode', context: { demoId: args.event.output } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			checkingRequestedMode: {
				always: (args) => {
					const { context } = args
					if ((context.scope.connectionId === required(context.demoId)) !== simplefinDemo) {
						return { target: 'modeMismatch' }
					}
					return { target: 'loadingConnections' }
				}
			},
			loadingConnections: {
				invoke: {
					src: 'connections',
					input: ({ context }) => context,
					onDone: (args) => {
						if (
							args.event.output.some((row) => (row.id === args.context.demoId) !== simplefinDemo)
						) {
							return { target: 'modeMismatch' }
						}
						return { target: 'choosingConnectionCheck' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			choosingConnectionCheck: {
				always: (args) => {
					if (args.context.requireConnection) {
						return { target: 'loadingConnection' }
					}
					return { target: 'recheckingIdentity' }
				}
			},
			loadingConnection: {
				invoke: {
					src: 'connection',
					input: ({ context }) => context,
					onDone: (args) => {
						return { target: 'checkingCiphertext', context: { connection: args.event.output[0] } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			checkingCiphertext: {
				always: (args) => {
					if (!args.context.connection?.ciphertext) {
						return { target: 'disconnected' }
					}
					return { target: 'checkingExpectedCiphertext' }
				}
			},
			checkingExpectedCiphertext: {
				always: (args) => {
					const { context } = args
					if (!context.expectedCiphertext) {
						return { target: 'recheckingIdentity' }
					}
					if (context.connection?.ciphertext === context.expectedCiphertext) {
						return { target: 'recheckingIdentity' }
					}
					return { target: 'disconnected' }
				}
			},
			recheckingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => ({
						userId: context.scope.ownerId,
						organizationId: context.scope.organizationId
					}),
					onDone: (args) => {
						if (args.event.output.error !== undefined) {
							return { target: 'unauthorized' }
						}
						return { target: 'authorized' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			authorized: { type: 'final' },
			unauthorized: {
				type: 'final',
				entry: () => {
					return { context: { error: new Error('unauthorized') } }
				}
			},
			modeMismatch: {
				type: 'final',
				entry: () => {
					return { context: { error: new Error('mode_mismatch') } }
				}
			},
			disconnected: {
				type: 'final',
				entry: () => {
					return { context: { error: new Error('disconnected') } }
				}
			},
			failed: { type: 'final' }
		}
	})
}
