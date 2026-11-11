import { accountStoreLock, type AccountLockInput } from './account-store-lock.js'
import { accountStoreReadMachine } from './account-store-read.js'
import { accountStoreLegacyMachine } from './account-store-legacy.js'
import {
	definitelyNotIssued,
	type AccountStoreStorage,
	type AccountStoreRequest,
	type AccountStoreResult
} from './account-store-contracts.js'
import {
	earlierSelection,
	droppedAccountRoots,
	type AccountStorageBinding
} from '../../runtime/worker/account-selection.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'

type Input = {
	request: AccountStoreRequest
	binding: AccountStorageBinding
	storage: AccountStoreStorage
	locks: AccountLockInput['locks']
}
type Context = Omit<Input, 'request'> & {
	request: AccountStoreRequest | undefined
	hostClosedScope: string | undefined
	replacement: string | undefined
	dropped: string[]
	result: AccountStoreResult | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Account store resource unavailable')
	return value
}
const actors = {
	lock: accountStoreLock,
	legacy: accountStoreLegacyMachine,
	read: accountStoreReadMachine,
	snapshot: createAsyncLogic({
		run: ({ input }: { input: AccountStoreStorage }) => input.readSnapshot()
	}),
	transform: createAsyncLogic({
		run: async ({
			input
		}: {
			input: { transform: (value: string | null) => string; current: string | null }
		}) => {
			const replacement = input.transform(input.current)
			return { replacement, dropped: droppedAccountRoots(input.current, replacement) }
		}
	}),
	write: createAsyncLogic({
		run: ({ input }: { input: { storage: AccountStoreStorage; value: string } }) =>
			input.storage.writePrimary(input.value)
	}),
	drain: createAsyncLogic({
		run: ({ input }: { input: AccountStoreStorage }) => input.closeHostAndDrain()
	})
}
const events0 = {
	LOCKED: types(),
	RELEASED: types(),
	LOCK_FAILED: types(),
	SHUTDOWN: types(),
	HOST_CLOSED: types<{ scope: string }>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<typeof actors.lock>
			| import('xstate').OutputFrom<typeof actors.legacy>
			| import('xstate').OutputFrom<typeof actors.read>
			| import('xstate').OutputFrom<typeof actors.snapshot>
			| import('xstate').OutputFrom<typeof actors.transform>
			| import('xstate').OutputFrom<typeof actors.write>
			| import('xstate').OutputFrom<typeof actors.drain>
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
		context: types<Context>(),
		input: types<Input>(),
		output: types<AccountStoreResult>(),
		events: events0,
		children: {
			lock: types<import('xstate').ActorRefFrom<typeof actors.lock>>(),
			legacy: types<import('xstate').ActorRefFrom<typeof actors.legacy>>(),
			read: types<import('xstate').ActorRefFrom<typeof actors.read>>(),
			snapshot: types<import('xstate').ActorRefFrom<typeof actors.snapshot>>(),
			transform: types<import('xstate').ActorRefFrom<typeof actors.transform>>(),
			write: types<import('xstate').ActorRefFrom<typeof actors.write>>(),
			drain: types<import('xstate').ActorRefFrom<typeof actors.drain>>()
		}
	},
	states: {
		route: { type: 'choice' },
		reading: {},
		updating: {
			type: 'parallel',
			states: {
				control: { states: { active: {}, stopping: {} } },
				work: {
					states: {
						acquiring: {},
						reading: {},
						transforming: {
							schemas: {
								input: types<{
									transform: (value: string | null) => string
									current: string | null
								}>()
							}
						},
						writing: {
							schemas: {
								context: types<{ replacement: string }>()
							}
						},
						cleanup: {
							schemas: {
								context: types<{ replacement: string }>()
							}
						},
						scrubbing: { schemas: { input: types<{ key: string }>() } },
						draining: { schemas: { context: types<{ result: AccountStoreResult }>() } },
						retained: { schemas: { context: types<{ result: AccountStoreResult }>() } },
						releasing: { schemas: { context: types<{ result: AccountStoreResult }>() } }
					}
				}
			}
		},
		done: {
			id: 'finance-account-store-done',
			type: 'final',
			schemas: { context: types<{ result: AccountStoreResult }>() }
		}
	},
	actors,
	guards: {
		stopping: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ updating: { control: 'stopping' } }, value),
		definitelyNotIssued: (
			_: { context: Context; event: NativeEvent0; value: import('xstate').StateValue },
			params: { error: unknown }
		) => definitelyNotIssued(params.error),
		needsLegacyCleanup: (
			_: { context: Context; event: NativeEvent0; value: import('xstate').StateValue },
			params: { key: string | undefined; currentKey: string; dropped: string[] }
		) => !!params.key && params.key !== params.currentKey && params.dropped.length > 0
	}
})
/** One SDK read/update request. The public owner must retain this actor through
 * done; an uncertain native write cannot release its Web Lock before host drain. */
export const accountStoreOperationMachine = model.createMachine({
	id: 'finance-account-store-operation',
	initial: 'route',
	context: ({ input }) => ({
		...input,
		hostClosedScope: undefined,
		replacement: undefined,
		dropped: [],
		result: undefined
	}),
	output: ({ context }) => required(context.result),
	states: {
		route: {
			type: 'choice',
			choice: ({ context }) => {
				if (required(context.request).kind === 'read') return { target: 'reading' }
				return { target: 'updating' }
			}
		},
		reading: {
			on: { SHUTDOWN: { target: 'done', context: { result: { kind: 'canceled' } } } },
			invoke: {
				id: 'read',
				src: 'read',
				input: ({ context }) => ({ storage: context.storage, binding: context.binding }),
				onDone: ({ event }) => ({
					target: 'done',
					context: {
						result: { kind: 'read', value: event.output.value }
					}
				}),
				onError: {
					target: 'done',
					context: { result: { kind: 'failed', writeOutcome: 'not-issued' } }
				}
			}
		},
		updating: {
			type: 'parallel',
			invoke: {
				id: 'lock',
				src: 'lock',
				input: ({ context }) => ({ key: context.binding.key, locks: context.locks })
			},
			on: {
				LOCK_FAILED: {
					target: '#finance-account-store-done',
					context: { result: { kind: 'failed', writeOutcome: 'not-issued' } }
				},
				HOST_CLOSED: (args, enq) => {
					const { context, event, children, value } = args
					if (event.scope !== context.storage.scope) return
					if (matchesState({ updating: { work: 'scrubbing' } }, value)) {
						if (children.legacy?.getSnapshot().status === 'active') enq.sendTo('legacy', event)
						return { context: { hostClosedScope: event.scope } }
					}
					const issued = matchesState({ updating: { work: 'writing' } }, value)
					const acknowledged = matchesState({ updating: { work: 'cleanup' } }, value)
					return {
						target: '.work.releasing',
						context: {
							hostClosedScope: event.scope,
							result:
								context.result ??
								(acknowledged
									? { kind: 'updated', legacyCleanup: 'unavailable' }
									: { kind: 'failed', writeOutcome: issued ? 'unknown' : 'not-issued' })
						}
					}
				}
			},
			onError: ({ context }) => {
				const result: AccountStoreResult = context.result ?? {
					kind: 'failed',
					writeOutcome: 'unknown'
				}
				if (context.hostClosedScope === context.storage.scope)
					return { target: '.work.releasing', context: { result } }
				return { target: '.work.draining', context: { result } }
			},
			states: {
				control: {
					initial: 'active',
					states: { active: { on: { SHUTDOWN: { target: 'stopping' } } }, stopping: {} }
				},
				work: {
					initial: 'acquiring',
					states: {
						acquiring: {
							on: {
								LOCKED: (args) => {
									if (args.guards.stopping(args))
										return { target: 'releasing', context: { result: { kind: 'canceled' } } }
									return { target: 'reading' }
								},
								SHUTDOWN: (_, enq) => {
									enq.sendTo('lock', { type: 'RELEASE' })
								},
								RELEASED: {
									target: '#finance-account-store-done',
									context: { result: { kind: 'canceled' } }
								}
							}
						},
						reading: {
							invoke: {
								id: 'read',
								src: 'read',
								input: ({ context }) => ({ storage: context.storage, binding: context.binding }),
								onDone: (args) => {
									if (args.guards.stopping(args))
										return { target: 'releasing', context: { result: { kind: 'canceled' } } }
									const request = required(args.context.request)
									if (request.kind !== 'update')
										return {
											target: 'releasing',
											context: { result: { kind: 'failed', writeOutcome: 'not-issued' } }
										}
									return {
										target: 'transforming',
										input: {
											transform: request.transform,
											current: args.event.output.value
										},
										context: { request: undefined }
									}
								},
								onError: {
									target: 'releasing',
									context: { result: { kind: 'failed', writeOutcome: 'not-issued' } }
								}
							}
						},
						transforming: {
							invoke: {
								id: 'transform',
								src: 'transform',
								input: ({ input }) => input,
								onDone: (args) => {
									if (args.guards.stopping(args))
										return { target: 'releasing', context: { result: { kind: 'canceled' } } }
									return {
										target: 'writing',
										context: {
											replacement: args.event.output.replacement,
											dropped: args.event.output.dropped
										}
									}
								},
								onError: {
									target: 'releasing',
									context: { result: { kind: 'failed', writeOutcome: 'not-issued' } }
								}
							}
						},
						writing: {
							invoke: {
								id: 'write',
								src: 'write',
								input: ({ context }) => ({ storage: context.storage, value: context.replacement }),
								onDone: { target: 'cleanup' },
								onError: (args) => {
									if (args.guards.definitelyNotIssued(args, args.event))
										return {
											target: 'releasing',
											context: { result: { kind: 'failed', writeOutcome: 'not-issued' } }
										}
									return {
										target: 'draining',
										context: { result: { kind: 'failed', writeOutcome: 'unknown' } }
									}
								}
							}
						},
						cleanup: {
							invoke: {
								id: 'snapshot',
								src: 'snapshot',
								input: ({ context }) => context.storage,
								onDone: (args) => {
									// Match SDK timing: discover the earlier store again after the
									// primary write, since another tab may have created it meanwhile.
									const earlier = earlierSelection(args.context.binding, args.event.output.earlier)
									if (
										earlier &&
										args.guards.needsLegacyCleanup(args, {
											key: earlier.key,
											currentKey: args.context.binding.key,
											dropped: args.context.dropped
										})
									) {
										return {
											target: 'scrubbing',
											input: { key: earlier.key },
											context: { replacement: undefined }
										}
									}
									return {
										target: 'releasing',
										context: { result: { kind: 'updated', legacyCleanup: 'complete' } }
									}
								},
								onError: {
									target: 'releasing',
									context: { result: { kind: 'updated', legacyCleanup: 'unavailable' } }
								}
							}
						},
						scrubbing: {
							invoke: {
								id: 'legacy',
								src: 'legacy',
								input: ({ context, input }) => ({
									key: input.key,
									dropped: context.dropped,
									storage: context.storage,
									locks: context.locks
								}),
								onDone: ({ event }) => ({
									target: 'releasing',
									context: {
										result: {
											kind: 'updated',
											legacyCleanup: event.output ? 'complete' : 'unavailable'
										}
									}
								}),
								onError: ({ context }) => {
									if (context.hostClosedScope === context.storage.scope)
										return {
											target: 'releasing',
											context: { result: { kind: 'updated', legacyCleanup: 'unavailable' } }
										}
									return {
										target: 'draining',
										context: { result: { kind: 'updated', legacyCleanup: 'unavailable' } }
									}
								}
							}
						},
						draining: {
							invoke: {
								id: 'drain',
								src: 'drain',
								input: ({ context }) => context.storage,
								onDone: { target: 'releasing' },
								onError: ({ context }) =>
									context.hostClosedScope === context.storage.scope
										? { target: 'releasing' }
										: { target: 'retained' }
							}
						},
						retained: {
							on: {
								HOST_CLOSED: ({ context, event }) =>
									event.scope === context.storage.scope ? { target: 'releasing' } : undefined
							}
						},
						releasing: {
							entry: (_, enq) => {
								enq.sendTo('lock', { type: 'RELEASE' })
							},
							on: { RELEASED: { target: '#finance-account-store-done' } }
						}
					}
				}
			}
		},
		done: {
			id: 'finance-account-store-done',
			type: 'final',
			entry: () => ({
				context: {
					replacement: undefined,
					dropped: [],
					request: undefined,
					hostClosedScope: undefined
				}
			})
		}
	}
})
