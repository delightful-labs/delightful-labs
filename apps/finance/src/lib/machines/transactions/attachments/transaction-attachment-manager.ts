import type { getDb } from 'jazz-tools/svelte'
import {
	transactionAttachmentRemovalMachine,
	type TransactionAttachmentRemovalResult
} from './transaction-attachment-removal.js'
import { setup, types } from 'xstate'

type Db = Pick<ReturnType<typeof getDb>, 'all' | 'delete'>
export type TransactionAttachmentManagerInput = {
	db: Db
	transactionId: string
}
type Context = TransactionAttachmentManagerInput & {
	queue: string[]
	currentAttachmentId: string | undefined
	results: { attachmentId: string; result: TransactionAttachmentRemovalResult }[]
	shuttingDown: boolean
}
type Event =
	| { type: 'REMOVE'; attachmentId: string }
	| { type: 'SCOPE'; transactionId: string }
	| { type: 'SHUTDOWN' }
const patchReplaceScope = ({ event }: { event: Event }): Partial<Context> => ({
	transactionId: event.type === 'SCOPE' ? event.transactionId : '',
	queue: []
})
const patchStop = (): Partial<Context> => ({ shuttingDown: true })
const patchRecordFailure = ({ context }: { context: Context }): Partial<Context> => ({
	results: [
		...context.results,
		{
			attachmentId: context.currentAttachmentId ?? '',
			result: { outcome: 'failed' }
		}
	],
	currentAttachmentId: undefined
})
const patchBegin = ({ context }: { context: Context }): Partial<Context> => ({
	currentAttachmentId: context.queue[0],
	queue: context.queue.slice(1)
})
const patchEnqueue = ({
	context,
	event
}: {
	context: Context
	event: Event
}): Partial<Context> => ({
	queue: event.type === 'REMOVE' ? [...context.queue, event.attachmentId] : context.queue
})
const events0 = {
	REMOVE: types<{ attachmentId: string }>(),
	SCOPE: types<{ transactionId: string }>(),
	SHUTDOWN: types<{}>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			import('xstate').OutputFrom<typeof transactionAttachmentRemovalMachine>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Owns repeated removal requests and drains the active removal child during page shutdown. */
export const transactionAttachmentManagerMachine = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<TransactionAttachmentManagerInput>(),
		children: {
			remove:
				types<
					import('xstate').ActorRefFrom<
						{ remove: typeof transactionAttachmentRemovalMachine }['remove']
					>
				>()
		}
	},
	actors: { remove: transactionAttachmentRemovalMachine },
	actions: {},
	guards: {
		canQueue: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
			!context.shuttingDown &&
			event.type === 'REMOVE' &&
			!context.queue.includes(event.attachmentId) &&
			context.currentAttachmentId !== event.attachmentId,
		hasRequests: ({ context }: { context: Context }) => context.queue.length > 0,
		stopping: ({ context }: { context: Context }) => context.shuttingDown
	}
}).createMachine({
	id: 'transaction-attachment-manager',
	initial: 'checking',
	context: ({ input }) => ({
		...input,
		queue: [],
		currentAttachmentId: undefined,
		results: [],
		shuttingDown: false
	}),
	on: {
		REMOVE: (args) => {
			if (!args.guards.canQueue(args)) return
			return { context: patchEnqueue(args) }
		},
		SCOPE: (args) => {
			return { context: patchReplaceScope(args) }
		},
		SHUTDOWN: (args) => {
			return { context: patchStop() }
		}
	},
	states: {
		checking: {
			always: (args) => {
				if (args.guards.stopping(args)) {
					return { target: 'closed' }
				}
				if (args.guards.hasRequests(args)) {
					return { target: 'removing', context: patchBegin(args) }
				}
				return { target: 'idle' }
			}
		},
		idle: {
			always: (args) => {
				if (args.guards.stopping(args)) {
					return { target: 'closed' }
				}
			},
			on: {
				REMOVE: (args) => {
					if (!args.guards.canQueue(args)) return
					return { target: 'checking', context: patchEnqueue(args) }
				}
			}
		},
		removing: {
			invoke: {
				id: 'remove',
				src: 'remove',
				input: ({ context }) => ({
					db: context.db,
					transactionId: context.transactionId,
					attachmentId: context.currentAttachmentId ?? ''
				}),
				onDone: (args) => {
					const { context } = args
					return {
						target: 'checking',
						context: {
							results: [
								...context.results,
								{ attachmentId: context.currentAttachmentId ?? '', result: args.event.output }
							],
							currentAttachmentId: undefined
						}
					}
				},
				onError: (args) => {
					return { target: 'checking', context: patchRecordFailure(args) }
				}
			}
		},
		closed: { type: 'final' }
	}
})
