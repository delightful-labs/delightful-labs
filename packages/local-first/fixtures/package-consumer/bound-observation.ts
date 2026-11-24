import assert from 'node:assert/strict'
import { createActor, setup, types } from 'xstate'
import { createBoundObservationLogic } from 'delightful-local-first/data/observation-workflow'

type Input = { binding: object }
type Report =
	| { type: 'VALUE'; binding: object; value: string }
	| { type: 'FAILED'; binding: object }
let publish = (_value: string) => {}
let failure = () => {}
let disposals = 0
const observation = createBoundObservationLogic<string, Input, Report>({
	observe: (_input, next, failed) => {
		publish = next
		failure = failed
		next('local')
		return () => {
			disposals++
			next('during-disposal')
			failed()
		}
	},
	observed: (input, value) => ({ type: 'VALUE', binding: input.binding, value }),
	failed: (input) => ({ type: 'FAILED', binding: input.binding })
})
const parent = setup({
	schemas: {
		input: types<Input>(),
		context: types<{ input: Input; values: string[]; failures: number }>(),
		events: {
			VALUE: types<{ binding: object; value: string }>(),
			FAILED: types<{ binding: object }>(),
			END: types()
		}
	},
	actors: { observation }
}).createMachine({
	context: ({ input }) => ({ input, values: [], failures: 0 }),
	initial: 'observing',
	on: {
		VALUE: ({ context, event }) => {
			assert.equal(event.binding, context.input.binding)
			return { context: { values: [...context.values, event.value] } }
		},
		FAILED: ({ context }) => ({ context: { failures: context.failures + 1 } })
	},
	states: {
		observing: {
			invoke: { src: 'observation', input: ({ context }) => context.input },
			on: { END: { target: 'idle' } }
		},
		idle: {}
	}
})
const actor = createActor(parent, { input: { binding: {} } }).start()
try {
	assert.deepEqual(actor.getSnapshot().context.values, ['local'])
	publish('updated')
	actor.send({ type: 'END' })
	publish('late')
	failure()
	assert.deepEqual(actor.getSnapshot().context.values, ['local', 'updated'])
	assert.equal(actor.getSnapshot().context.failures, 0)
	assert.equal(disposals, 1)
} finally {
	actor.stop()
}
assert.equal(disposals, 1)

// Native receipt qualification through the actual packed public API.
for (const fail of [false, true]) {
	let released = 0
	let failures = 0
	const owned = createBoundObservationLogic<
		never,
		Input,
		{
			type: 'RELEASED'
			binding: object
			outcome: 'released' | 'unresolved'
		}
	>({
		observe: () => () => {
			released++
			if (fail) throw new Error('Native disposal failed')
		},
		observed: () => {
			throw new Error('No data source')
		},
		failed: () => {
			throw new Error('No read failure')
		},
		disposalFailed: () => {
			failures++
		},
		released: (input, outcome) => ({ type: 'RELEASED', binding: input.binding, outcome })
	})
	const parent = setup({
		schemas: {
			input: types<Input>(),
			context: types<Input>(),
			events: { RELEASED: types<{ binding: object; outcome: 'released' | 'unresolved' }>() }
		},
		actors: { owned }
	}).createMachine({
		context: ({ input }) => input,
		initial: 'releasing',
		states: {
			releasing: {
				invoke: { id: 'owned', src: 'owned', input: ({ context }) => context },
				entry: (_, enq) => enq.sendTo('owned', { type: 'RELEASE' }),
				on: {
					RELEASED: ({ context, event }) => {
						assert.equal(event.binding, context.binding)
						assert.equal(released, 1)
						return event.outcome === 'released' ? { target: 'closed' } : { target: 'unresolved' }
					}
				}
			},
			closed: { type: 'final' },
			unresolved: {}
		}
	})
	const owner = createActor(parent, { input: { binding: {} } }).start()
	try {
		assert.equal(owner.getSnapshot().matches(fail ? 'unresolved' : 'closed'), true)
		assert.equal(failures, fail ? 1 : 0)
	} finally {
		owner.stop()
	}
	assert.equal(released, 1)
}
