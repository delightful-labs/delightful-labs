import { createAccountReconnectMachine } from './account-reconnect.js'
import { createAccountCreationMachine } from './account-create.js'
import { createAccountWriteMachine } from './account-write.js'
import { createAccountUnlinkMachine } from './account-unlink.js'
import { required } from './identity.js'
import type { MappingInterruption } from './account-write-transaction.js'
import type { Dependencies, OperationWork, ProviderSummary, Result } from './types.js'
import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = { work: OperationWork; discovered: ProviderSummary[] }
type Context = Input & { provider: ProviderSummary | undefined; error: unknown }

export function createAccountMappingMachine(dependencies: Dependencies) {
	const actors = {
		reconnect: createAccountReconnectMachine(dependencies),
		createAccount: createAccountCreationMachine(dependencies),
		mapAccount: createAccountWriteMachine(dependencies),
		unlinkAccount: createAccountUnlinkMachine(dependencies)
	}
	const events0 = {
		MAP: types<EventPayload<{ type: 'MAP' } | MappingInterruption, 'MAP'>>(),
		CANCEL: types<EventPayload<{ type: 'MAP' } | MappingInterruption, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<{ type: 'MAP' } | MappingInterruption, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['reconnect']>
				| import('xstate').OutputFrom<(typeof actors)['createAccount']>
				| import('xstate').OutputFrom<(typeof actors)['mapAccount']>
				| import('xstate').OutputFrom<(typeof actors)['unlinkAccount']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<Result<undefined>>(),
			children: {
				reconnect: types<import('xstate').ActorRefFrom<(typeof actors)['reconnect']>>(),
				createAccount: types<import('xstate').ActorRefFrom<(typeof actors)['createAccount']>>(),
				mapAccount: types<import('xstate').ActorRefFrom<(typeof actors)['mapAccount']>>(),
				unlinkAccount: types<import('xstate').ActorRefFrom<(typeof actors)['unlinkAccount']>>()
			}
		},
		actors
	}).createMachine({
		id: 'bank-account-mapping',
		context: ({ input }) => ({ ...input, provider: undefined, error: undefined }),
		initial: 'checkingCommand',
		on: {
			CANCEL: () => {
				return { target: '.failed', context: { error: new Error('disconnected') } }
			},
			SHUTDOWN: () => {
				return { target: '.failed', context: { error: new Error('disconnected') } }
			}
		},
		output: ({ context }) =>
			context.error === undefined
				? { ok: true, value: undefined }
				: { ok: false, error: context.error },
		states: {
			checkingCommand: {
				always: (args) => {
					const { context } = args
					if (context.work.command.type === 'RECONNECT') return { target: 'reconnecting' }
					if (context.work.command.type === 'CREATE_ACCOUNT') {
						return { target: 'selectingProvider' }
					}
					if (context.work.command.type === 'MAP') {
						return { target: 'selectingProvider' }
					}
					return { target: 'invalidMapping' }
				}
			},
			reconnecting: {
				on: {
					CANCEL: (_, enq) => {
						enq.sendTo('reconnect', { type: 'CANCEL' })
						return {}
					},
					SHUTDOWN: (_, enq) => {
						enq.sendTo('reconnect', { type: 'SHUTDOWN' })
						return {}
					}
				},
				invoke: {
					id: 'reconnect',
					src: 'reconnect',
					input: ({ context }) => context,
					onDone: ({ event }) =>
						event.output.ok
							? { target: 'complete' }
							: { target: 'failed', context: { error: event.output.error } },
					onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
				}
			},
			selectingProvider: {
				entry: (args) => {
					return {
						context: {
							provider: (({ context }) => {
								const command = context.work.command
								return 'providerId' in command
									? context.discovered.find((row) => row.id === command.providerId)
									: undefined
							})(args)
						}
					}
				},
				always: (args) => {
					const { context } = args
					if (!context.provider) {
						return { target: 'invalidMapping' }
					}
					if (context.work.command.type === 'CREATE_ACCOUNT') {
						return { target: 'creating' }
					}
					return { target: 'choosingMapping' }
				}
			},
			choosingMapping: {
				always: (args) => {
					const { context } = args
					if (context.work.command.type === 'MAP' && !context.work.command.accountId) {
						return { target: 'unlinking' }
					}
					return { target: 'mapping' }
				}
			},
			creating: {
				on: {
					CANCEL: (args, enq) => {
						{
							const child = args.children.createAccount
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
					},
					SHUTDOWN: (args, enq) => {
						{
							const child = args.children.createAccount
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
						}
					}
				},
				invoke: {
					id: 'createAccount',
					src: 'createAccount',
					input: ({ context }) => ({ work: context.work, provider: required(context.provider) }),
					onDone: (args) => {
						const { event } = args
						if (!event.output.ok) {
							return {
								target: 'failed',
								context: { error: event.output.ok ? undefined : event.output.error }
							}
						}
						return { target: 'complete' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			mapping: {
				on: {
					CANCEL: (args, enq) => {
						{
							const child = args.children.mapAccount
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
					},
					SHUTDOWN: (args, enq) => {
						{
							const child = args.children.mapAccount
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
						}
					}
				},
				invoke: {
					id: 'mapAccount',
					src: 'mapAccount',
					input: ({ context }) => ({
						kind: 'map',
						work: context.work,
						provider: required(context.provider),
						accountId: required(
							context.work.command.type === 'MAP' ? context.work.command.accountId : undefined
						)
					}),
					onDone: (args) => {
						const { event } = args
						if (!event.output.ok) {
							return {
								target: 'failed',
								context: { error: event.output.ok ? undefined : event.output.error }
							}
						}
						return { target: 'complete' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			unlinking: {
				on: {
					CANCEL: (args, enq) => {
						{
							const child = args.children.unlinkAccount
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
					},
					SHUTDOWN: (args, enq) => {
						{
							const child = args.children.unlinkAccount
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
						}
					}
				},
				invoke: {
					id: 'unlinkAccount',
					src: 'unlinkAccount',
					input: ({ context }) => ({
						work: context.work,
						providerId: required(context.provider).id
					}),
					onDone: (args) => {
						const { event } = args
						if (!event.output.ok) {
							return {
								target: 'failed',
								context: { error: event.output.ok ? undefined : event.output.error }
							}
						}
						return { target: 'complete' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			complete: { type: 'final' },
			invalidMapping: {
				type: 'final',
				entry: () => {
					return { context: { error: new Error('mapping') } }
				}
			},
			failed: { type: 'final' }
		}
	})
}
