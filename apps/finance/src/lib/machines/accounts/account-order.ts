import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type OrderEvent =
	| { type: 'EDIT' }
	| { type: 'DONE' }
	| { type: 'RESET'; ids: readonly string[] }
	| { type: 'OBSERVE'; ids: readonly string[] }
	| { type: 'MOVE'; id: string; direction: 'up' | 'down' }

export function orderAccounts<T extends { id: string }>(
	accounts: readonly T[],
	ids: readonly string[]
): T[] {
	const positions = new Map(ids.map((id, index) => [id, index]))
	return [...accounts].sort(
		(left, right) =>
			(positions.get(left.id) ?? ids.length) - (positions.get(right.id) ?? ids.length)
	)
}
const events0 = {
	EDIT: types<EventPayload<OrderEvent, 'EDIT'>>(),
	DONE: types<EventPayload<OrderEvent, 'DONE'>>(),
	RESET: types<EventPayload<OrderEvent, 'RESET'>>(),
	OBSERVE: types<EventPayload<OrderEvent, 'OBSERVE'>>(),
	MOVE: types<EventPayload<OrderEvent, 'MOVE'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<never>
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

const order = setup({
	schemas: { context: types<{ ids: readonly string[] }>(), events: events0 }
})
const observe = ({ event }: { event: NativeEvent0 }) =>
	event.type === 'RESET' || event.type === 'OBSERVE' ? { ids: event.ids } : {}
const canMove = ({
	context,
	event
}: {
	context: { ids: readonly string[] }
	event: OrderEvent
}) => {
	if (event.type !== 'MOVE') return false
	const index = context.ids.indexOf(event.id)
	return event.direction === 'up' ? index > 0 : index >= 0 && index < context.ids.length - 1
}
const move = ({ context, event }: { context: { ids: readonly string[] }; event: NativeEvent0 }) => {
	if (event.type !== 'MOVE') return {}
	const ids = [...context.ids]
	const index = ids.indexOf(event.id)
	const destination = index + (event.direction === 'up' ? -1 : 1)
	ids.splice(index, 1)
	ids.splice(destination, 0, event.id)
	return { ids }
}

export const accountOrderMachine = order.createMachine({
	id: 'account-order',
	initial: 'viewing',
	context: { ids: [] },
	on: {
		RESET: (args) => {
			return { target: '.viewing', context: observe(args) }
		},
		OBSERVE: (args) => {
			return { context: observe(args) }
		}
	},
	states: {
		viewing: {
			on: {
				EDIT: (args) => {
					if (!(args.context.ids.length > 1)) return
					return { target: 'editing' }
				}
			}
		},
		editing: {
			always: (args) => {
				if (!(args.context.ids.length < 2)) return
				return { target: 'viewing' }
			},
			on: {
				DONE: { target: 'viewing' },
				MOVE: (args) => {
					if (!canMove(args)) return
					return { context: move(args) }
				}
			}
		}
	}
})
