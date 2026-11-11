import { setup, types } from 'xstate'

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

type MachineArgs = { context: Context; event: Event }

// Pure context patches; transition functions own when each patch is applied.
const patches = {
	configure: ({ event }: MachineArgs) =>
		event.type === 'CONFIGURE' ? event.configuration : {},
	measure: ({ event }: MachineArgs) =>
		event.type === 'MEASURE'
			? {
					width: event.width,
					leftWidth: event.leftWidth,
					rightWidth: event.rightWidth
				}
			: {},
	begin: ({ context, event }: MachineArgs) =>
		event.type === 'DOWN'
			? {
					pointerId: event.pointerId,
					startX: event.x,
					startY: event.y,
					originOffset: context.offset,
					blockClick: false
				}
			: {},
	move: ({ context, event }: MachineArgs) =>
		event.type === 'MOVE' ? { offset: dragOffset(context, event) } : {},
	claim: (_args: MachineArgs) => ({ blockClick: true }),
	consumeClick: (_args: MachineArgs) => ({ blockClick: false }),
	openSide: ({ context, event }: MachineArgs) => ({
		offset:
			event.type === 'REVEAL'
				? drawerOffset(context, event.side)
				: context.offset,
		pointerId: null,
		originOffset: 0,
		blockClick: false
	}),
	close: (_args: MachineArgs) => ({ offset: 0, pointerId: null }),
	clearChoice: (_args: MachineArgs) => ({ choice: null }),
	exit: ({ context }: MachineArgs) => ({
		offset: context.choice?.side === 'left' ? context.width : -context.width,
		pointerId: null
	}),
	restore: ({ context }: MachineArgs) => ({
		offset: context.originOffset,
		pointerId: null
	}),
	reveal: ({ context }: MachineArgs) => ({
		offset: revealOffset(context),
		pointerId: null
	}),
	chooseSwipe: ({ context }: MachineArgs) => {
		const action = armedSwipeAction(context)
		const side = swipeSide(context.offset)
		return {
			choice:
				action && side
					? { id: action.id, side, source: 'swipe' as const }
					: null
		}
	},
	chooseButton: ({ event }: MachineArgs) => ({
		choice:
			event.type === 'CHOOSE'
				? { id: event.id, side: event.side, source: 'button' as const }
				: null
	})
}

const machine = setup({
	schemas: {
		context: types<Context>(),
		input: types<Configuration>(),
		events: {
			CONFIGURE: types<{ configuration: Configuration }>(),
			MEASURE: types<{
				width: number
				leftWidth: number
				rightWidth: number
			}>(),
			DOWN: types<{ pointerId: number; x: number; y: number }>(),
			MOVE: types<{ pointerId: number; x: number; y: number }>(),
			UP: types<{ pointerId: number }>(),
			CANCEL: types<{}>(),
			CLOSE: types<{}>(),
			REVEAL: types<{ side: SwipeSide }>(),
			CONSUME_CLICK: types<{}>(),
			CHOOSE: types<{ side: SwipeSide; id: string }>(),
			DISMISS_COMPLETE: types<{}>(),
			RESET: types<{}>()
		},
		emitted: { 'action.chosen': types<{ detail: SwipeActionChosen }>() }
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
		CONFIGURE: (args) => {
			const patch = {
				...patches.configure(args),
				...patches.close(args)
			}
			return { target: '.resting.closed', context: patch }
		},
		MEASURE: (args) => {
			if (args.guards.widthChanged(args)) {
				const patch = {
					...patches.measure(args),
					...patches.close(args)
				}
				return { target: '.resting.closed', context: patch }
			}
			return { context: patches.measure(args) }
		},
		DOWN: (args) => {
			if (!args.guards.canInteract(args)) return
			return { target: '.tracking', context: patches.begin(args) }
		},
		REVEAL: (args) => {
			if (!args.guards.canReveal(args)) return
			return { target: '.resting.open', context: patches.openSide(args) }
		},
		CLOSE: (args) => {
			return { target: '.resting.closed', context: patches.close(args) }
		},
		CONSUME_CLICK: (args) => {
			return { context: patches.consumeClick(args) }
		},
		RESET: (args) => {
			const patch = {
				...patches.close(args),
				...patches.clearChoice(args)
			}
			return { target: '.resting.closed', context: patch }
		}
	},
	states: {
		resting: {
			initial: 'closed',
			states: {
				closed: {},
				open: {
					on: {
						CHOOSE: (args) => {
							if (!args.guards.validChoice(args)) return
							return {
								target: '#swipe-actions.chosen',
								context: patches.chooseButton(args)
							}
						}
					}
				}
			}
		},
		tracking: {
			on: {
				MOVE: (args) => {
					if (args.guards.verticalIntent(args)) {
						return { target: 'yielding' }
					}
					if (args.guards.horizontalIntent(args)) {
						const patch = {
							...patches.move(args),
							...patches.claim(args)
						}
						return { target: 'dragging', context: patch }
					}
				},
				UP: (args) => {
					if (!args.guards.samePointer(args)) return
					return { target: 'restoring' }
				},
				CANCEL: { target: 'restoring' }
			}
		},
		yielding: {
			on: {
				UP: (args) => {
					if (!args.guards.samePointer(args)) return
					return { target: 'restoring' }
				},
				CANCEL: { target: 'restoring' }
			}
		},
		dragging: {
			initial: 'revealing',
			on: {
				MOVE: (args) => {
					if (!args.guards.samePointer(args)) return
					return { context: patches.move(args) }
				},
				UP: (args) => {
					if (
						args.guards.samePointer(args) &&
						args.guards.dismissOnSwipe(args)
					) {
						const choice = patches.chooseSwipe(args)
						const patch = {
							...choice,
							...patches.exit({
								...args,
								context: { ...args.context, ...choice }
							})
						}
						return { target: 'dismissal', context: patch }
					}
					if (args.guards.samePointer(args) && args.guards.armed(args)) {
						return { target: 'chosen', context: patches.chooseSwipe(args) }
					}
					if (args.guards.samePointer(args) && args.guards.reveal(args)) {
						return {
							target: 'resting.open',
							context: patches.reveal(args)
						}
					}
					if (args.guards.samePointer(args)) {
						return {
							target: 'resting.closed',
							context: patches.close(args)
						}
					}
				},
				CANCEL: { target: 'restoring' }
			},
			states: {
				revealing: {
					always: (args) => {
						if (!args.guards.armed(args)) return
						return { target: 'armed' }
					}
				},
				armed: {
					always: (args) => {
						if (!args.guards.unarmed(args)) return
						return { target: 'revealing' }
					}
				}
			}
		},
		restoring: {
			always: (args) => {
				if (args.guards.restoreOpen(args)) {
					return { target: 'resting.open', context: patches.restore(args) }
				}
				return { target: 'resting.closed', context: patches.close(args) }
			}
		},
		chosen: {
			entry: (args, enq) => {
				const { context } = args
				if (context.choice) {
					enq.emit({ type: 'action.chosen', detail: context.choice })
				}
			},
			always: (args) => {
				return { target: 'resting.closed', context: patches.close(args) }
			}
		},
		dismissal: {
			initial: 'animating',
			// A committed exit cannot be reopened or emit a second choice.
			on: {
				DOWN: {},
				REVEAL: {},
				CLOSE: {},
				CANCEL: {},
				CONFIGURE: (args) => {
					return { context: patches.configure(args) }
				},
				MEASURE: (args) => {
					return { context: patches.measure(args) }
				}
			},
			states: {
				animating: {
					on: {
						DISMISS_COMPLETE: (args, enq) => {
							const { context } = args
							if (context.choice) {
								enq.emit({ type: 'action.chosen', detail: context.choice })
							}
							return { target: 'complete' }
						}
					}
				},
				complete: {}
			}
		}
	}
})
