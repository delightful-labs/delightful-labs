import { and, assign, enqueueActions, setup } from 'xstate'

export type SwipeSide = 'left' | 'right'
export type SwipeAction = {
	id: string
	label: string
	variant?: 'primary' | 'secondary' | 'destructive'
	disabled?: boolean
	/** Continue off the row on a full swipe when this is the final enabled action. */
	dismissOnSwipe?: boolean
}
export type SwipeActionChosen = {
	id: string
	side: SwipeSide
	source: 'swipe' | 'button'
}

type Configuration = {
	leftActions: readonly SwipeAction[]
	rightActions: readonly SwipeAction[]
	disabled: boolean
}
type Context = Configuration & {
	width: number
	leftWidth: number
	rightWidth: number
	pointerId: number | null
	startX: number
	startY: number
	originOffset: number
	offset: number
	blockClick: boolean
	choice: SwipeActionChosen | null
}
type Move = { type: 'MOVE'; pointerId: number; x: number; y: number }
type Event =
	| { type: 'CONFIGURE'; configuration: Configuration }
	| { type: 'MEASURE'; width: number; leftWidth: number; rightWidth: number }
	| { type: 'DOWN'; pointerId: number; x: number; y: number }
	| Move
	| { type: 'UP'; pointerId: number }
	| { type: 'CANCEL' }
	| { type: 'CLOSE' }
	| { type: 'REVEAL'; side: SwipeSide }
	| { type: 'CONSUME_CLICK' }
	| { type: 'CHOOSE'; side: SwipeSide; id: string }
	| { type: 'DISMISS_COMPLETE' }
	| { type: 'RESET' }

export function swipeSide(offset: number): SwipeSide | null {
	return offset > 0 ? 'left' : offset < 0 ? 'right' : null
}

function enabled(context: Context, side: SwipeSide) {
	return (side === 'left' ? context.leftActions : context.rightActions).filter(
		(action) => !action.disabled
	)
}

function dragOffset(context: Context, event: Move) {
	const next = context.originOffset + event.x - context.startX
	const side = swipeSide(next)
	if (!side || enabled(context, side).length === 0) return 0
	return Math.max(-context.width, Math.min(context.width, next))
}

/** Ordered stages: 35%, evenly spaced middle actions, then 90% for the final action. */
export function armedSwipeAction(context: Context): SwipeAction | undefined {
	const side = swipeSide(context.offset)
	if (!side || context.width <= 0) return
	// Reopening a tray must require a deliberate additional drag before choosing.
	if (Math.abs(context.offset - context.originOffset) < 24) return
	const actions = enabled(context, side)
	const progress = Math.abs(context.offset) / context.width
	if (actions.length === 1) return progress >= 0.9 ? actions[0] : undefined
	if (progress < 0.35) return
	const index = Math.min(
		actions.length - 1,
		Math.floor(((progress - 0.35) / 0.55) * (actions.length - 1) + 1e-9)
	)
	return actions[index]
}

function revealOffset(context: Context) {
	const side = swipeSide(context.offset)
	if (!side) return 0
	return drawerOffset(context, side)
}

function drawerOffset(context: Context, side: SwipeSide) {
	const width = side === 'left' ? context.leftWidth : context.rightWidth
	const distance = Math.max(0, Math.min(width, context.width - 44))
	return side === 'left' ? distance : -distance
}

const machine = setup({
	types: {} as {
		context: Context
		input: Configuration
		events: Event
		emitted: { type: 'action.chosen'; detail: SwipeActionChosen }
	},
	guards: {
		canInteract: ({ context }) =>
			!context.disabled &&
			(enabled(context, 'left').length > 0 ||
				enabled(context, 'right').length > 0),
		canReveal: ({ context, event }) =>
			!context.disabled &&
			event.type === 'REVEAL' &&
			enabled(context, event.side).length > 0,
		samePointer: ({ context, event }) =>
			'pointerId' in event && event.pointerId === context.pointerId,
		verticalIntent: ({ context, event }) =>
			event.type === 'MOVE' &&
			event.pointerId === context.pointerId &&
			Math.abs(event.y - context.startY) > 8 &&
			Math.abs(event.y - context.startY) >= Math.abs(event.x - context.startX),
		horizontalIntent: ({ context, event }) =>
			event.type === 'MOVE' &&
			event.pointerId === context.pointerId &&
			Math.abs(event.x - context.startX) > 8 &&
			Math.abs(event.x - context.startX) > Math.abs(event.y - context.startY),
		armed: ({ context }) => Boolean(armedSwipeAction(context)),
		dismissOnSwipe: ({ context }) => {
			const side = swipeSide(context.offset)
			const action = armedSwipeAction(context)
			return Boolean(
				side &&
				action?.dismissOnSwipe &&
				Math.abs(context.offset) / context.width >= 0.9 &&
				action === enabled(context, side).at(-1)
			)
		},
		unarmed: ({ context }) => !armedSwipeAction(context),
		reveal: ({ context }) =>
			Math.abs(context.offset) >= Math.min(44, context.width * 0.15),
		restoreOpen: ({ context }) => context.originOffset !== 0,
		widthChanged: ({ context, event }) =>
			event.type === 'MEASURE' && event.width !== context.width,
		validChoice: ({ context, event }) =>
			!context.disabled &&
			event.type === 'CHOOSE' &&
			event.side === swipeSide(context.offset) &&
			enabled(context, event.side).some((action) => action.id === event.id)
	},
	actions: {
		configure: assign(({ event }) =>
			event.type === 'CONFIGURE' ? event.configuration : {}
		),
		measure: assign(({ event }) =>
			event.type === 'MEASURE'
				? {
						width: event.width,
						leftWidth: event.leftWidth,
						rightWidth: event.rightWidth
					}
				: {}
		),
		begin: assign(({ context, event }) =>
			event.type === 'DOWN'
				? {
						pointerId: event.pointerId,
						startX: event.x,
						startY: event.y,
						originOffset: context.offset,
						blockClick: false
					}
				: {}
		),
		move: assign(({ context, event }) =>
			event.type === 'MOVE' ? { offset: dragOffset(context, event) } : {}
		),
		claim: assign({ blockClick: true }),
		consumeClick: assign({ blockClick: false }),
		openSide: assign(({ context, event }) => ({
			offset:
				event.type === 'REVEAL'
					? drawerOffset(context, event.side)
					: context.offset,
			pointerId: null,
			originOffset: 0,
			blockClick: false
		})),
		close: assign({ offset: 0, pointerId: null }),
		clearChoice: assign({ choice: null }),
		exit: assign(({ context }) => ({
			offset: context.choice?.side === 'left' ? context.width : -context.width,
			pointerId: null
		})),
		restore: assign({
			offset: ({ context }) => context.originOffset,
			pointerId: null
		}),
		reveal: assign({
			offset: ({ context }) => revealOffset(context),
			pointerId: null
		}),
		chooseSwipe: assign(({ context }) => {
			const action = armedSwipeAction(context)
			const side = swipeSide(context.offset)
			return {
				choice:
					action && side
						? { id: action.id, side, source: 'swipe' as const }
						: null
			}
		}),
		chooseButton: assign(({ event }) => ({
			choice:
				event.type === 'CHOOSE'
					? { id: event.id, side: event.side, source: 'button' as const }
					: null
		})),
		notify: enqueueActions(({ context, enqueue }) => {
			if (context.choice) {
				enqueue.emit({ type: 'action.chosen', detail: context.choice })
			}
		})
	}
})

export const swipeActionsMachine = machine.createMachine({
	id: 'swipe-actions',
	context: ({ input }) => ({
		...input,
		width: 0,
		leftWidth: 0,
		rightWidth: 0,
		pointerId: null,
		startX: 0,
		startY: 0,
		originOffset: 0,
		offset: 0,
		blockClick: false,
		choice: null
	}),
	initial: 'resting',
	on: {
		CONFIGURE: {
			target: '.resting.closed',
			actions: ['configure', 'close']
		},
		MEASURE: [
			{
				guard: 'widthChanged',
				target: '.resting.closed',
				actions: ['measure', 'close']
			},
			{ actions: 'measure' }
		],
		DOWN: { guard: 'canInteract', target: '.tracking', actions: 'begin' },
		REVEAL: {
			guard: 'canReveal',
			target: '.resting.open',
			actions: 'openSide'
		},
		CLOSE: { target: '.resting.closed', actions: 'close' },
		CONSUME_CLICK: { actions: 'consumeClick' },
		RESET: { target: '.resting.closed', actions: ['close', 'clearChoice'] }
	},
	states: {
		resting: {
			initial: 'closed',
			states: {
				closed: {},
				open: {
					on: {
						CHOOSE: {
							guard: 'validChoice',
							target: '#swipe-actions.chosen',
							actions: 'chooseButton'
						}
					}
				}
			}
		},
		tracking: {
			on: {
				MOVE: [
					{ guard: 'verticalIntent', target: 'yielding' },
					{
						guard: 'horizontalIntent',
						target: 'dragging',
						actions: ['move', 'claim']
					}
				],
				UP: { guard: 'samePointer', target: 'restoring' },
				CANCEL: 'restoring'
			}
		},
		yielding: {
			on: {
				UP: { guard: 'samePointer', target: 'restoring' },
				CANCEL: 'restoring'
			}
		},
		dragging: {
			initial: 'revealing',
			on: {
				MOVE: { guard: 'samePointer', actions: 'move' },
				UP: [
					{
						guard: and(['samePointer', 'dismissOnSwipe']),
						target: 'dismissal',
						actions: ['chooseSwipe', 'exit']
					},
					{
						guard: and(['samePointer', 'armed']),
						target: 'chosen',
						actions: 'chooseSwipe'
					},
					{
						guard: and(['samePointer', 'reveal']),
						target: 'resting.open',
						actions: 'reveal'
					},
					{ guard: 'samePointer', target: 'resting.closed', actions: 'close' }
				],
				CANCEL: 'restoring'
			},
			states: {
				revealing: { always: { guard: 'armed', target: 'armed' } },
				armed: { always: { guard: 'unarmed', target: 'revealing' } }
			}
		},
		restoring: {
			always: [
				{ guard: 'restoreOpen', target: 'resting.open', actions: 'restore' },
				{ target: 'resting.closed', actions: 'close' }
			]
		},
		chosen: {
			entry: 'notify',
			always: { target: 'resting.closed', actions: 'close' }
		},
		dismissal: {
			initial: 'animating',
			// A committed exit cannot be reopened or emit a second choice.
			on: {
				DOWN: {},
				REVEAL: {},
				CLOSE: {},
				CANCEL: {},
				CONFIGURE: { actions: 'configure' },
				MEASURE: { actions: 'measure' }
			},
			states: {
				animating: {
					on: { DISMISS_COMPLETE: { target: 'complete', actions: 'notify' } }
				},
				complete: {}
			}
		}
	}
})
