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
