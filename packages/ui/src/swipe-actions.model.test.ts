import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import {
	assertTestCoverage,
	propertyTest,
	testPaths,
	type TestSut
} from '@xstate/test'
import {
	createActor,
	setup,
	types,
	type EventFrom,
	type SnapshotFrom
} from 'xstate'
import {
	swipeActionsMachine,
	type SwipeActionChosen
} from './lib/Components/internal/swipe-actions.js'

// A product contract, independent of production guards and pointer calculations.
const model = setup({
	schemas: {
		context: types<{ choices: SwipeActionChosen[] }>(),
		events: {
			OPEN_LEFT: types<{}>(),
			OPEN_RIGHT: types<{}>(),
			CLOSE: types<{}>(),
			RESET: types<{}>(),
			CHOOSE_LEFT: types<{}>(),
			CHOOSE_RIGHT: types<{}>(),
			INVALID: types<{}>()
		}
	}
}).createMachine({
	id: 'contract',
	initial: 'closed',
	context: { choices: [] },
	on: {
		OPEN_LEFT: { target: '.left' },
		OPEN_RIGHT: { target: '.right' },
		CLOSE: { target: '.closed' },
		RESET: { target: '.closed' },
		CHOOSE_LEFT: {},
		CHOOSE_RIGHT: {},
		INVALID: {}
	},
	states: {
		closed: {},
		left: {
			on: {
				CHOOSE_LEFT: ({ context }) => ({
					target: 'closed',
					context: {
						choices: [
							...context.choices,
							{ id: 'archive', side: 'left', source: 'button' }
						]
					}
				})
			}
		},
		right: {
			on: {
				CHOOSE_RIGHT: ({ context }) => ({
					target: 'closed',
					context: {
						choices: [
							...context.choices,
							{ id: 'favorite', side: 'right', source: 'button' }
						]
					}
				})
			}
		}
	}
})

const sut: TestSut<SnapshotFrom<typeof model>, EventFrom<typeof model>> = {
	create: () => {
		const choices: SwipeActionChosen[] = []
		const actor = createActor(swipeActionsMachine, {
			input: {
				disabled: false,
				leftActions: [
					{ id: 'archive', label: 'Archive' },
					{ id: 'delete', label: 'Delete', disabled: true }
				],
				rightActions: [{ id: 'favorite', label: 'Favorite' }]
			}
		})
		const subscription = actor.on('action.chosen', (event) =>
			choices.push(event.detail)
		)
		actor.start()
		actor.send({ type: 'MEASURE', width: 400, leftWidth: 176, rightWidth: 176 })
		return {
			send(event) {
				const commands = {
					OPEN_LEFT: () => actor.send({ type: 'REVEAL', side: 'left' }),
					OPEN_RIGHT: () => actor.send({ type: 'REVEAL', side: 'right' }),
					CLOSE: () => actor.send({ type: 'CLOSE' }),
					RESET: () => actor.send({ type: 'RESET' }),
					CHOOSE_LEFT: () =>
						actor.send({ type: 'CHOOSE', side: 'left', id: 'archive' }),
					CHOOSE_RIGHT: () =>
						actor.send({ type: 'CHOOSE', side: 'right', id: 'favorite' }),
					INVALID: () =>
						actor.send({ type: 'CHOOSE', side: 'left', id: 'delete' })
				}
				commands[event.type]()
			},
			read() {
				const snapshot = actor.getSnapshot()
				expect(snapshot.status).toBe('active')
				expect(snapshot.matches('resting')).toBe(true)
				return {
					phase: snapshot.matches({ resting: 'closed' })
						? 'closed'
						: snapshot.context.offset > 0
							? 'left'
							: 'right',
					choices: [...choices]
				}
			},
			dispose() {
				subscription.unsubscribe()
				actor.stop()
			}
		}
	},
	projectModel: (snapshot) => ({
		phase: snapshot.value,
		choices: snapshot.context.choices
	})
}
const events = {
	OPEN_LEFT: fc.constant({}),
	OPEN_RIGHT: fc.constant({}),
	CLOSE: fc.constant({}),
	RESET: fc.constant({}),
	CHOOSE_LEFT: fc.constant({}),
	CHOOSE_RIGHT: fc.constant({}),
	INVALID: fc.constant({})
}

it('matches the button contract across generated sequences', async () => {
	const { coverage } = await propertyTest(model, {
		events,
		sut,
		seed: 20261109,
		numRuns: 250,
		maxCommands: 60,
		failures: { key: 'swipe-buttons' }
	})
	assertTestCoverage(coverage, { eventTypes: 1 })
})

it('matches shortest paths through the bounded button contract', async () => {
	const { coverage } = await testPaths(model, {
		events,
		sut,
		limit: 500,
		stopWhen: (snapshot) => snapshot.context.choices.length >= 2,
		failures: { key: 'swipe-button-paths' }
	})
	assertTestCoverage(coverage, { stateNodes: 1 })
})
