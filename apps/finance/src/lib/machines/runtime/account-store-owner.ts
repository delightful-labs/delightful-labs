import { accountStoreOperationMachine } from './account-store-operation.js'
import type { AccountLockInput } from './account-store-lock.js'
import type { AccountStoreStorage } from './account-store-contracts.js'
import type { AccountStorageBinding } from '../../runtime/worker/account-storage-namespace.js'
import {
	MAX_ACCOUNT_STORE_REQUESTS,
	type AccountStoreEnvelope
} from './account-store-owner-contracts.js'
import { setup, types, matchesState, createAsyncLogic } from 'xstate'
import type { ActorRefFrom } from 'xstate'

type Input = {
	binding: AccountStorageBinding
	storage: AccountStoreStorage
	locks: AccountLockInput['locks']
}
type Context = Input & {
	queue: AccountStoreEnvelope[]
	current: AccountStoreEnvelope | undefined
}
const drain = createAsyncLogic({
	run: ({ input }: { input: AccountStoreStorage }) => input.closeHostAndDrain()
})
const events0 = {
	REQUEST: types<AccountStoreEnvelope>(),
	SHUTDOWN: types(),
	HOST_CLOSED: types<{ scope: string }>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<ActorRefFrom<typeof accountStoreOperationMachine>>
			| import('xstate').OutputFrom<ActorRefFrom<typeof drain>>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent
const model = setup({
	schemas: {
		input: types<Input>(),
		context: types<Context>(),
		events: events0,
		internalEvents: { ADMISSION_CLOSED: types() },
		children: {
			operation: types<ActorRefFrom<typeof accountStoreOperationMachine>>(),
			drain: types<ActorRefFrom<typeof drain>>()
		}
	},
	states: {
		active: {
			type: 'parallel',
			states: {
				control: { states: { open: {}, closing: {} } },
				work: {
					states: {
						idle: {},
						selecting: {},
						busy: { schemas: { context: types<{ current: AccountStoreEnvelope }>() } }
					}
				}
			}
		},
		faultClosing: { id: 'finance-account-owner-fault-closing' },
		faultRetained: {},
		faultDone: { type: 'final' },
		hostClosed: { id: 'finance-account-owner-host-closed', type: 'final' },
		stopped: { id: 'finance-account-owner-stopped', type: 'final' }
	},
	actors: { operation: accountStoreOperationMachine, drain },
	guards: {
		admitting: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ active: { control: 'open' } }, value)
	}
})
/** Invoke under the worker root. Shutdown is a protocol: never force-stop this
 * owner while a child retains an issued write or native Web Lock. */
export const accountStoreOwnerMachine = model.createMachine({
	id: 'finance-account-store-owner',
	initial: 'active',
	context: ({ input }) => ({ ...input, queue: [], current: undefined }),
	on: {
		REQUEST: ({ event }, enq) => {
			enq(() => event.respond({ kind: 'unavailable', reason: 'closed' }))
		}
	},
	states: {
		active: {
			type: 'parallel',
			onError: { target: '#finance-account-owner-fault-closing' },
			on: {
				REQUEST: (args, enq) => {
					const { context, event, value } = args
					if (!args.guards.admitting(args)) {
						enq(() => event.respond({ kind: 'unavailable', reason: 'closed' }))
						return
					}
					if (context.queue.length + (context.current ? 1 : 0) >= MAX_ACCOUNT_STORE_REQUESTS) {
						enq(() => event.respond({ kind: 'unavailable', reason: 'overloaded' }))
						return
					}
					const queue = [...context.queue, { request: event.request, respond: event.respond }]
					if (matchesState({ active: { work: 'idle' } }, value))
						return { target: '.work.selecting', context: { queue } }
					return { context: { queue } }
				},
				HOST_CLOSED: ({ context, event, children }, enq) => {
					if (event.scope !== context.storage.scope) return
					if (children.operation?.getSnapshot().status === 'active') enq.sendTo('operation', event)
					enq.raise({ type: 'SHUTDOWN' })
				}
			},
			states: {
				control: {
					initial: 'open',
					states: {
						open: { on: { SHUTDOWN: { target: 'closing' } } },
						closing: {
							entry: ({ context }, enq) => {
								enq(() => {
									for (const item of context.queue) item.respond({ kind: 'canceled' })
								})
								enq.raise({ type: 'ADMISSION_CLOSED' })
								return { context: { queue: [] } }
							}
						}
					}
				},
				work: {
					initial: 'idle',
					states: {
						idle: { on: { ADMISSION_CLOSED: { target: '#finance-account-owner-stopped' } } },
						selecting: {
							always: (args) => {
								if (!args.guards.admitting(args))
									return { target: '#finance-account-owner-stopped' }
								const [current, ...queue] = args.context.queue
								if (current) return { target: 'busy', context: { current, queue } }
								return { target: 'idle' }
							}
						},
						busy: {
							on: {
								SHUTDOWN: (_, enq) => {
									enq.sendTo('operation', { type: 'SHUTDOWN' })
								}
							},
							invoke: {
								id: 'operation',
								src: 'operation',
								input: ({ context }) => ({
									request: context.current.request,
									binding: context.binding,
									storage: context.storage,
									locks: context.locks
								}),
								onDone: ({ context, event }, enq) => {
									enq(() => context.current.respond(event.output))
									if (event.output.kind === 'failed' && event.output.writeOutcome === 'unknown')
										return {
											target: '#finance-account-owner-host-closed',
											context: { current: undefined }
										}
									return { target: 'selecting', context: { current: undefined } }
								},
								onError: { target: '#finance-account-owner-fault-closing' }
							}
						}
					}
				}
			}
		},
		faultClosing: {
			id: 'finance-account-owner-fault-closing',
			entry: ({ context }, enq) => {
				enq(() => {
					for (const item of context.queue) item.respond({ kind: 'unavailable', reason: 'closed' })
				})
				return { context: { queue: [] } }
			},
			invoke: {
				id: 'drain',
				src: 'drain',
				input: ({ context }) => context.storage,
				onDone: { target: 'faultDone' },
				onError: { target: 'faultRetained' }
			},
			on: {
				HOST_CLOSED: ({ context, event }) =>
					event.scope === context.storage.scope ? { target: 'faultDone' } : undefined
			}
		},
		faultRetained: {
			on: {
				HOST_CLOSED: ({ context, event }) =>
					event.scope === context.storage.scope ? { target: 'faultDone' } : undefined
			}
		},
		faultDone: {
			type: 'final',
			entry: ({ context }, enq) => {
				enq(() => context.current?.respond({ kind: 'failed', writeOutcome: 'unknown' }))
				return { context: { current: undefined, queue: [] } }
			}
		},
		hostClosed: {
			id: 'finance-account-owner-host-closed',
			type: 'final',
			entry: ({ context }, enq) => {
				enq(() => {
					for (const item of context.queue) item.respond({ kind: 'unavailable', reason: 'closed' })
				})
				return { context: { queue: [], current: undefined } }
			}
		},
		stopped: { id: 'finance-account-owner-stopped', type: 'final' }
	}
})
