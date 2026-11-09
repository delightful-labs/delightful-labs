import { createActor, type Actor, type InputFrom } from 'xstate'
import { afterEach, describe, expect, it } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { SwipeActions } from './lib/index.js'
import {
	swipeActionsMachine,
	type SwipeActionChosen
} from './lib/Components/internal/swipe-actions.js'

type SwipeActor = Actor<typeof swipeActionsMachine>
const actors: SwipeActor[] = []
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
})

function fixture(
	configuration: Partial<InputFrom<typeof swipeActionsMachine>> = {}
) {
	const actor = createActor(swipeActionsMachine, {
		input: {
			leftActions: [
				{ id: 'archive', label: 'Archive' },
				{ id: 'delete', label: 'Delete' }
			],
			rightActions: [
				{ id: 'favorite', label: 'Favorite' },
				{ id: 'unread', label: 'Unread' }
			],
			disabled: false,
			...configuration
		}
	})
	actors.push(actor)
	const choices: SwipeActionChosen[] = []
	actor.on('action.chosen', ({ detail }) => choices.push(detail))
	actor.start()
	actor.send({ type: 'MEASURE', width: 400, leftWidth: 176, rightWidth: 176 })
	return {
		actor,
		choices,
		down: () => actor.send({ type: 'DOWN', pointerId: 1, x: 0, y: 0 }),
		move: (x: number, y = 0) =>
			actor.send({ type: 'MOVE', pointerId: 1, x, y }),
		up: () => actor.send({ type: 'UP', pointerId: 1 })
	}
}

describe('swipe action interaction', () => {
	it('leaves taps and small pointer jitter to the native target', () => {
		const f = fixture()
		f.down()
		f.move(5, 3)
		f.up()
		expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
		expect(f.actor.getSnapshot().context.blockClick).toBe(false)
		expect(f.choices).toEqual([])
	})

	it('yields to vertical scrolling and never arms a later sideways movement', () => {
		const f = fixture()
		f.down()
		f.move(2, 35)
		expect(f.actor.getSnapshot().matches('yielding')).toBe(true)
		f.move(380, 35)
		f.up()
		expect(f.choices).toEqual([])
		expect(f.actor.getSnapshot().context.blockClick).toBe(false)
	})

	it('closes a short drag and suppresses only its compatibility click', () => {
		const f = fixture()
		f.down()
		f.move(20)
		f.up()
		expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
		expect(f.actor.getSnapshot().context.blockClick).toBe(true)
		f.actor.send({ type: 'CONSUME_CLICK' })
		expect(f.actor.getSnapshot().context.blockClick).toBe(false)
		expect(f.choices).toEqual([])
	})

	for (const { sign, side, first, last } of [
		{ sign: 1, side: 'left', first: 'archive', last: 'delete' },
		{ sign: -1, side: 'right', first: 'favorite', last: 'unread' }
	] as const) {
		it(`reveals ${side} buttons without choosing, then accepts a native button choice`, () => {
			const f = fixture()
			f.down()
			f.move(sign * 80)
			f.up()
			expect(f.actor.getSnapshot().matches({ resting: 'open' })).toBe(true)
			expect(f.choices).toEqual([])
			f.actor.send({ type: 'CHOOSE', side, id: first })
			expect(f.choices).toEqual([{ id: first, side, source: 'button' }])
			expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
		})

		for (const { distance, id } of [
			{ distance: 160, id: first },
			{ distance: 360, id: last }
		]) {
			it(`chooses ${id} once on release at ${distance / 4}% toward ${side}`, () => {
				const f = fixture()
				f.down()
				f.move(sign * distance)
				expect(f.actor.getSnapshot().matches({ dragging: 'armed' })).toBe(true)
				expect(f.choices).toEqual([])
				f.up()
				f.up()
				expect(f.choices).toEqual([{ id, side, source: 'swipe' }])
				expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
			})
		}
	}

	it('steps back from the final action to the intermediate action before release', () => {
		const f = fixture({
			leftActions: [
				{ id: 'archive', label: 'Archive' },
				{ id: 'trash', label: 'Trash' },
				{ id: 'delete', label: 'Delete' }
			]
		})
		f.down()
		f.move(370)
		f.move(270)
		f.up()
		expect(f.choices).toEqual([{ id: 'trash', side: 'left', source: 'swipe' }])
	})

	it('reverses an armed swipe and chooses only the opposite side', () => {
		const f = fixture()
		f.down()
		f.move(370)
		f.move(-160)
		f.up()
		expect(f.choices).toEqual([
			{ id: 'favorite', side: 'right', source: 'swipe' }
		])
	})

	it('retreats from an armed swipe to an open drawer without choosing', () => {
		const f = fixture()
		f.down()
		f.move(370)
		f.move(80)
		f.up()
		expect(f.actor.getSnapshot().matches({ resting: 'open' })).toBe(true)
		expect(f.choices).toEqual([])
	})

	it('ignores unrelated pointer movement and release', () => {
		const f = fixture()
		f.down()
		f.move(160)
		f.actor.send({ type: 'MOVE', pointerId: 2, x: -380, y: 0 })
		f.actor.send({ type: 'UP', pointerId: 2 })
		expect(f.choices).toEqual([])
		f.up()
		expect(f.choices).toEqual([
			{ id: 'archive', side: 'left', source: 'swipe' }
		])
	})

	it('does not choose after cancellation or a width change', () => {
		for (const event of [
			{ type: 'CANCEL' },
			{ type: 'MEASURE', width: 320, leftWidth: 176, rightWidth: 176 }
		] as const) {
			const f = fixture()
			f.down()
			f.move(380)
			f.actor.send(event)
			f.up()
			expect(f.choices).toEqual([])
			expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
		}
	})

	it('requires a deliberate additional drag when an already-open drawer is touched', () => {
		const f = fixture()
		f.down()
		f.move(80)
		f.up()
		f.down()
		f.move(12)
		f.up()
		expect(f.choices).toEqual([])
		expect(f.actor.getSnapshot().matches({ resting: 'open' })).toBe(true)
		f.down()
		f.move(60)
		f.actor.send({ type: 'CANCEL' })
		expect(f.actor.getSnapshot().matches({ resting: 'open' })).toBe(true)
		expect(f.choices).toEqual([])
	})

	it('suppresses navigation for a drag toward an unavailable side', () => {
		const f = fixture({ rightActions: [] })
		f.down()
		f.move(-370)
		f.up()
		expect(f.choices).toEqual([])
		expect(f.actor.getSnapshot().context.blockClick).toBe(true)
		expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
	})

	it('reserves a single enabled action for a full swipe and rejects disabled choices', () => {
		const f = fixture({
			leftActions: [
				{ id: 'archive', label: 'Archive', disabled: true },
				{ id: 'delete', label: 'Delete' }
			]
		})
		f.down()
		f.move(160)
		f.up()
		f.actor.send({ type: 'CHOOSE', side: 'left', id: 'archive' })
		f.actor.send({ type: 'CHOOSE', side: 'left', id: 'missing' })
		expect(f.choices).toEqual([])
		f.actor.send({ type: 'CLOSE' })
		f.down()
		f.move(370)
		f.up()
		expect(f.choices).toEqual([{ id: 'delete', side: 'left', source: 'swipe' }])
	})

	it('reveals the same underlying right-hand drawer for keyboard access', () => {
		const f = fixture()
		f.actor.send({ type: 'CHOOSE', side: 'right', id: 'unread' })
		expect(f.choices).toEqual([])
		f.actor.send({ type: 'REVEAL', side: 'right' })
		expect(f.actor.getSnapshot().matches({ resting: 'open' })).toBe(true)
		f.actor.send({ type: 'CHOOSE', side: 'right', id: 'unread' })
		expect(f.choices).toEqual([
			{ id: 'unread', side: 'right', source: 'button' }
		])
	})

	it('disabling during a drag cancels the action and retains click suppression', () => {
		const f = fixture()
		f.down()
		f.move(370)
		f.actor.send({
			type: 'CONFIGURE',
			configuration: {
				leftActions: [],
				rightActions: [],
				disabled: true
			}
		})
		f.up()
		f.actor.send({ type: 'REVEAL', side: 'right' })
		f.down()
		expect(f.choices).toEqual([])
		expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
		expect(f.actor.getSnapshot().context.blockClick).toBe(true)
	})
})

describe('full swipe dismissal', () => {
	for (const { sign, side } of [
		{ sign: 1, side: 'left' },
		{ sign: -1, side: 'right' }
	] as const) {
		it(`finishes exiting toward ${side} before choosing once, and can be reset`, () => {
			const f = fixture({
				[side === 'left' ? 'leftActions' : 'rightActions']: [
					{ id: 'keep', label: 'Keep' },
					{ id: 'archive', label: 'Archive', dismissOnSwipe: true }
				]
			})
			f.down()
			f.move(sign * 365)
			f.up()
			expect(f.actor.getSnapshot().matches({ dismissal: 'animating' })).toBe(
				true
			)
			expect(f.actor.getSnapshot().context.offset).toBe(sign * 400)
			expect(f.choices).toEqual([])
			f.down()
			f.up()
			f.actor.send({ type: 'CLOSE' })
			f.actor.send({ type: 'CANCEL' })
			f.actor.send({ type: 'REVEAL', side })
			f.actor.send({ type: 'CHOOSE', side, id: 'archive' })
			expect(f.actor.getSnapshot().matches({ dismissal: 'animating' })).toBe(
				true
			)
			f.actor.send({ type: 'DISMISS_COMPLETE' })
			f.actor.send({ type: 'DISMISS_COMPLETE' })
			expect(f.actor.getSnapshot().matches({ dismissal: 'complete' })).toBe(
				true
			)
			expect(f.choices).toEqual([{ id: 'archive', side, source: 'swipe' }])
			f.actor.send({ type: 'RESET' })
			expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
			f.down()
			f.move(sign * 160)
			f.up()
			expect(f.choices.at(-1)).toEqual({ id: 'keep', side, source: 'swipe' })
		})
	}

	it('only dismisses the final enabled action at the full swipe threshold', () => {
		const f = fixture({
			leftActions: [
				{ id: 'archive', label: 'Archive', dismissOnSwipe: true },
				{ id: 'delete', label: 'Delete' }
			]
		})
		f.down()
		f.move(160)
		f.up()
		expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
		f.down()
		f.move(370)
		f.up()
		expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
		expect(f.choices.map((choice) => choice.id)).toEqual(['archive', 'delete'])
	})

	it('does not dismiss a cancelled, resized or reversed full swipe', () => {
		for (const event of [
			{ type: 'CANCEL' },
			{ type: 'MEASURE', width: 320, leftWidth: 176, rightWidth: 176 },
			{ type: 'MOVE', pointerId: 1, x: 80, y: 0 }
		] as const) {
			const f = fixture({
				leftActions: [{ id: 'trash', label: 'Trash', dismissOnSwipe: true }]
			})
			f.down()
			f.move(370)
			f.actor.send(event)
			f.up()
			expect(f.actor.getSnapshot().matches('dismissal')).toBe(false)
			expect(f.choices).toEqual([])
		}
	})

	it('keeps choosing a dismissal action by button immediate and non-dismissing', () => {
		const f = fixture({
			leftActions: [{ id: 'trash', label: 'Trash', dismissOnSwipe: true }]
		})
		f.actor.send({ type: 'REVEAL', side: 'left' })
		f.actor.send({ type: 'CHOOSE', side: 'left', id: 'trash' })
		expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
		expect(f.choices).toEqual([{ id: 'trash', side: 'left', source: 'button' }])
	})

	it('reset cancels an unfinished dismissal and ignores its stale completion', () => {
		const f = fixture({
			leftActions: [{ id: 'trash', label: 'Trash', dismissOnSwipe: true }]
		})
		f.down()
		f.move(370)
		f.up()
		f.actor.send({ type: 'RESET' })
		f.actor.send({ type: 'DISMISS_COMPLETE' })
		expect(f.actor.getSnapshot().matches({ resting: 'closed' })).toBe(true)
		expect(f.choices).toEqual([])
	})
})

describe('swipe action server rendering', () => {
	it('renders only the supplied hidden action buttons and the native row content', () => {
		const { body } = render(SwipeActions, {
			props: {
				actionsLabel: 'Actions for Saved article & notes',
				leftActions: [
					{ id: 'archive', label: 'Archive & keep', disabled: true }
				],
				rightActions: [{ id: 'favorite', label: 'Favorite' }],
				children: createRawSnippet(() => ({
					render: () => '<a href="/saved">Saved article</a>'
				}))
			}
		})
		expect(body).toContain('href="/saved"')
		expect(body).toContain('aria-label="Actions for Saved article &amp; notes"')
		expect(body).toContain('aria-keyshortcuts="ArrowLeft ArrowRight Escape"')
		expect(body).toContain('Archive &amp; keep')
		expect([...body.matchAll(/<button\b/g)]).toHaveLength(2)
		expect([...body.matchAll(/\binert(?:=""|\s|>)/g)]).toHaveLength(2)
		expect(body).toMatch(/<button\b[^>]*\bdisabled(?:=""|\s|>)/)
	})
})
