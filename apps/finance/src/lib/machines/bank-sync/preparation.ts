import { stableUuid } from '#lib/data.js'
import { simplefinDemo } from '#lib/integrations/simplefin.js'
import type { CredentialScope } from '#lib/validation/integrations.js'
import { createIdentityMachine, required } from './identity.js'
import type { Connection, Dependencies, Observation, RequestIdentity, Result } from './types.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = { identity: RequestIdentity; requireConnection: boolean }
export type PreparedScope = { scope: CredentialScope; connection: Connection | undefined }
type Context = Input & {
	current: Observation | undefined
	scope: CredentialScope | undefined
	error: unknown
}

export function createPreparationMachine(dependencies: Dependencies) {
	const actors = {
		identity: createIdentityMachine(dependencies),
		connectionId: createAsyncLogic<string, { ownerId: string; organizationId: string }>({
			run: ({ input }) =>
				stableUuid(
					input.ownerId,
					`${simplefinDemo ? 'simplefin-demo' : 'simplefin'}:${input.organizationId}`
				)
		})
	}
	const events0 = { PREPARE: types<EventPayload<{ type: 'PREPARE' }, 'PREPARE'>>() }
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['identity']>
				| import('xstate').OutputFrom<(typeof actors)['connectionId']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<Result<PreparedScope>>(),
			children: {
				identity: types<import('xstate').ActorRefFrom<(typeof actors)['identity']>>(),
				connectionId: types<import('xstate').ActorRefFrom<(typeof actors)['connectionId']>>()
			}
		},
		actors
	}).createMachine({
		id: 'bank-preparation',
		context: ({ input }) => ({ ...input, current: undefined, scope: undefined, error: undefined }),
		initial: 'checkingIdentity',
		output: ({ context }) =>
			context.error === undefined
				? {
						ok: true,
						value: { scope: required(context.scope), connection: context.current?.connection }
					}
				: { ok: false, error: context.error },
		states: {
			checkingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => context.identity,
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'failed', context: { error: event.output.error } }
						}
						return { target: 'choosingConnection', context: { current: event.output.current } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			choosingConnection: {
				always: (args) => {
					const { context } = args
					if (Boolean(context.current?.connection)) {
						return { target: 'usingExistingConnection' }
					}
					if (context.requireConnection) {
						return { target: 'disconnected' }
					}
					return { target: 'generatingConnectionId' }
				}
			},
			usingExistingConnection: {
				entry: (args) => {
					const { context } = args
					return {
						context: {
							scope: {
								ownerId: required(context.current?.userId),
								organizationId: required(context.current?.organizationId),
								connectionId: required(context.current?.connection).id
							}
						}
					}
				},
				always: { target: 'prepared' }
			},
			generatingConnectionId: {
				invoke: {
					src: 'connectionId',
					input: ({ context }) => ({
						ownerId: required(context.current?.userId),
						organizationId: required(context.current?.organizationId)
					}),
					onDone: (args) => {
						const { context } = args
						return {
							target: 'recheckingIdentity',
							context: {
								scope: {
									ownerId: required(context.current?.userId),
									organizationId: required(context.current?.organizationId),
									connectionId: args.event.output
								}
							}
						}
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			recheckingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => context.identity,
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'failed', context: { error: event.output.error } }
						}
						return { target: 'prepared' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			prepared: { type: 'final' },
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
