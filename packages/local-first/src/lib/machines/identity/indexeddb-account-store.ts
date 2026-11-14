import { createAsyncLogic, createCallbackLogic, setup, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import {
	MAX_INDEXEDDB_ACCOUNT_CALLS,
	type IndexedDbAccountCall,
	type IndexedDbAccountNative,
	type IndexedDbAccountResult
} from '../../contracts/indexeddb-account-store.js'

type Context = {
	native: IndexedDbAccountNative
	queue: IndexedDbAccountCall[]
	current: IndexedDbAccountCall | undefined
}
function failed(
	reason: Extract<IndexedDbAccountResult, { kind: 'failed' }>['reason'],
	outcome: Extract<IndexedDbAccountResult, { kind: 'failed' }>['outcome'] = 'not-issued'
): IndexedDbAccountResult {
	return { kind: 'failed', reason, outcome }
}
const observe = createCallbackLogic<never, IndexedDbAccountNative>(({ input, sendBack }) => {
	const detach = input.listen(sendBack)
	input.open()
	return detach
})
const close = createAsyncLogic<void, IndexedDbAccountNative>({ run: ({ input }) => input.closed })
/** One owner per store capability. Native settlement, never request success,
 * advances the FIFO and permits connection shutdown. No SDK/domain logic here. */
export const indexedDbAccountStoreMachine = setup({
	schemas: {
		input: types<{ native: IndexedDbAccountNative }>(),
		context: types<Context>(),
		events: {
			CALL: types<{ call: IndexedDbAccountCall }>(),
			CLOSE: types(),
			OPENED: types(),
			OPEN_FAILED: types(),
			INVALIDATED: types(),
			SETTLED: types<{ id: number; result: IndexedDbAccountResult }>()
		},
		internalEvents: { PUMP: types() },
		children: {
			observe: types<ActorRefFrom<typeof observe>>(),
			close: types<ActorRefFrom<typeof close>>()
		}
	},
	actors: { observe, close }
}).createMachine({
	id: 'indexeddb-account-store',
	context: ({ input }) => ({ native: input.native, queue: [], current: undefined }),
	initial: 'opening',
	invoke: { id: 'observe', src: 'observe', input: ({ context }) => context.native },
	onError: { target: '.failedClosing' },
	on: {
		CALL: ({ event }, enq) => enq(event.call.respond, failed('closed')),
		CLOSE: {},
		OPENED: {},
		OPEN_FAILED: {},
		INVALIDATED: { target: '.draining' },
		SETTLED: {},
		PUMP: {}
	},
	states: {
		opening: {
			on: {
				CALL: ({ context, event }, enq) => {
					if (context.queue.length >= MAX_INDEXEDDB_ACCOUNT_CALLS) {
						enq(event.call.respond, failed('overloaded'))
						return
					}
					return { context: { queue: [...context.queue, event.call] } }
				},
				OPENED: { target: 'running' },
				OPEN_FAILED: { target: 'failedClosing' },
				CLOSE: { target: 'draining' }
			}
		},
		running: {
			initial: 'selecting',
			on: {
				CALL: ({ context, event }, enq) => {
					if (context.queue.length + (context.current ? 1 : 0) >= MAX_INDEXEDDB_ACCOUNT_CALLS) {
						enq(event.call.respond, failed('overloaded'))
						return
					}
					enq.raise({ type: 'PUMP' })
					return { context: { queue: [...context.queue, event.call] } }
				},
				SETTLED: ({ context, event }, enq) => {
					if (context.current?.id !== event.id) return
					enq(context.current.respond, event.result)
					return { target: '.selecting', context: { current: undefined } }
				},
				CLOSE: { target: 'draining' }
			},
			states: {
				selecting: {
					always: ({ context }) => {
						const [current, ...queue] = context.queue
						return current ? { target: 'busy', context: { current, queue } } : { target: 'idle' }
					}
				},
				idle: { on: { PUMP: { target: 'selecting' } } },
				busy: {
					entry: ({ context }, enq) => {
						if (context.current) enq(context.native.perform, context.current)
					}
				}
			}
		},
		draining: {
			entry: ({ context }, enq) => {
				for (const call of context.queue) enq(call.respond, failed('closed'))
				return { context: { queue: [] } }
			},
			always: ({ context }) => (context.current ? undefined : { target: 'closing' }),
			on: {
				INVALIDATED: {},
				SETTLED: ({ context, event }, enq) => {
					if (context.current?.id !== event.id) return
					enq(context.current.respond, event.result)
					return { context: { current: undefined } }
				}
			}
		},
		closing: {
			entry: ({ context }, enq) => enq(context.native.close),
			invoke: {
				id: 'close',
				src: 'close',
				input: ({ context }) => context.native,
				onDone: { target: 'closed' },
				onError: { target: 'blocked' }
			},
			on: { INVALIDATED: {} }
		},
		failedClosing: {
			entry: ({ context }, enq) => {
				for (const call of context.queue) enq(call.respond, failed('unavailable'))
				if (context.current) enq(context.current.respond, failed('unavailable', 'unknown'))
				enq(context.native.close)
				return { context: { queue: [], current: undefined } }
			},
			invoke: {
				id: 'close',
				src: 'close',
				input: ({ context }) => context.native,
				onDone: { target: 'closed' },
				onError: { target: 'blocked' }
			},
			on: { INVALIDATED: {} }
		},
		blocked: { on: { INVALIDATED: {} } },
		closed: { type: 'final' }
	}
})
