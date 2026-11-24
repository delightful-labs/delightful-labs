import { afterEach, expect, it, vi } from 'vitest'
import { createActor, setup, types } from 'xstate'
import * as fc from 'fast-check'
import { createBoundObservationLogic } from './observation.js'

type Input = { binding: object }
type Report =
	| { type: 'VALUE'; binding: object; value: number }
	| { type: 'FAILED'; binding: object }
	| { type: 'RELEASED'; binding: object; outcome: 'released' | 'unresolved' }
const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(options?: {
	initial?: number
	constructionError?: Error
	disposalError?: Error
	callbackDuringDisposal?: boolean
	absent?: boolean
	explicit?: boolean
}) {
	let publish = (_value: number) => {}
	let failed = () => {}
	const dispose = vi.fn(() => {
		if (options?.callbackDuringDisposal) {
			publish(999)
			failed()
		}
		if (options?.disposalError) throw options.disposalError
	})
	const disposalFailed = vi.fn()
	const observe = vi.fn((_input: Input, next: (value: number) => void, error: () => void) => {
		if (options?.absent) return undefined
		publish = next
		failed = error
		if (options?.constructionError) throw options.constructionError
		if (options?.initial !== undefined) next(options.initial)
		return dispose
	})
	const observation = createBoundObservationLogic<number, Input, Report>({
		observe,
		observed: (input, value) => ({ type: 'VALUE', binding: input.binding, value }),
		failed: (input) => ({ type: 'FAILED', binding: input.binding }),
		disposalFailed,
		released: options?.explicit
			? (input, outcome) => ({ type: 'RELEASED', binding: input.binding, outcome })
			: undefined
	})
	const machine = setup({
		schemas: {
			input: types<Input>(),
			context: types<{ input: Input; reports: Report[] }>(),
			events: {
				VALUE: types<{ binding: object; value: number }>(),
				FAILED: types<{ binding: object }>(),
				END: types(),
				RELEASE: types(),
				RELEASED: types<{ binding: object; outcome: 'released' | 'unresolved' }>()
			}
		},
		actors: { observation }
	}).createMachine({
		context: ({ input }) => ({ input, reports: [] }),
		initial: 'observing',
		on: {
			VALUE: ({ context, event }) => ({ context: { reports: [...context.reports, event] } }),
			FAILED: ({ context, event }) => ({ context: { reports: [...context.reports, event] } }),
			RELEASED: ({ context, event }) => ({ context: { reports: [...context.reports, event] } })
		},
		states: {
			observing: {
				invoke: { id: 'observation', src: 'observation', input: ({ context }) => context.input },
				on: {
					END: { target: 'idle' },
					RELEASE: (_, enq) => enq.sendTo('observation', { type: 'RELEASE' })
				}
			},
			idle: { on: { END: {} } }
		}
	})
	const binding = {}
	const actor = createActor(machine, { input: { binding } }).start()
	actors.add(actor)
	return {
		actor,
		binding,
		observe,
		dispose,
		disposalFailed,
		publish: (value: number) => publish(value),
		failed: () => failed(),
		reports: () => actor.getSnapshot().context.reports
	}
}

it('publishes synchronous and later values with the original opaque binding', () => {
	const f = fixture({ initial: 1 })
	f.publish(2)
	expect(f.observe).toHaveBeenCalledOnce()
	expect(f.reports()).toEqual([
		{ type: 'VALUE', binding: f.binding, value: 1 },
		{ type: 'VALUE', binding: f.binding, value: 2 }
	])
	expect(f.reports()[0]?.binding).toBe(f.binding)
	expect(f.dispose).not.toHaveBeenCalled()
})

it('reports construction and native read failures without inventing an empty value', () => {
	const startup = fixture({ constructionError: new Error('Subscribe refused') })
	expect(startup.reports()).toEqual([{ type: 'FAILED', binding: startup.binding }])
	startup.actor.send({ type: 'END' })
	expect(startup.dispose).not.toHaveBeenCalled()
	const native = fixture()
	native.failed()
	expect(native.reports()).toEqual([{ type: 'FAILED', binding: native.binding }])
})

it('leaves an absent source silent without inventing a value or cleanup receipt', () => {
	const f = fixture({ absent: true })
	f.actor.send({ type: 'END' })
	expect(f.observe).toHaveBeenCalledOnce()
	expect(f.reports()).toEqual([])
	expect(f.dispose).not.toHaveBeenCalled()
	expect(f.disposalFailed).not.toHaveBeenCalled()
})

it('withdraws callback admission before disposal and ignores late callbacks while the parent stays alive', () => {
	const f = fixture({ initial: 1, callbackDuringDisposal: true })
	f.actor.send({ type: 'END' })
	f.publish(2)
	f.failed()
	f.actor.send({ type: 'END' })
	expect(f.reports()).toEqual([{ type: 'VALUE', binding: f.binding, value: 1 }])
	expect(f.dispose).toHaveBeenCalledOnce()
	f.actor.stop()
	expect(f.dispose).toHaveBeenCalledOnce()
})

it('preserves the exact native disposal error at the host cleanup boundary', () => {
	const error = new Error('Native disposal failed')
	const f = fixture({ disposalError: error, callbackDuringDisposal: true })
	f.actor.send({ type: 'END' })
	expect(f.dispose).toHaveBeenCalledOnce()
	expect(f.disposalFailed).toHaveBeenCalledExactlyOnceWith({ binding: f.binding }, error)
	expect(f.reports()).toEqual([])
	f.publish(3)
	expect(f.reports()).toEqual([])
})

it('obeys callback admission and exactly-once release across generated schedules', () => {
	fc.assert(
		fc.property(
			fc.array(
				fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant('failed'), fc.constant('end')),
				{ maxLength: 30 }
			),
			(commands) => {
				const f = fixture({ callbackDuringDisposal: true })
				const expected: Report[] = []
				let ended = false
				try {
					for (const command of commands) {
						if (command === 'end') {
							ended = true
							f.actor.send({ type: 'END' })
						} else if (command === 'failed') {
							if (!ended) expected.push({ type: 'FAILED', binding: f.binding })
							f.failed()
						} else {
							if (!ended) expected.push({ type: 'VALUE', binding: f.binding, value: command })
							f.publish(command)
						}
						expect(f.reports()).toEqual(expected)
						expect(f.dispose).toHaveBeenCalledTimes(ended ? 1 : 0)
					}
				} finally {
					f.actor.stop()
					actors.delete(f.actor)
				}
				expect(f.dispose).toHaveBeenCalledOnce()
			}
		),
		{ seed: 20261125, numRuns: 100 }
	)
})

it('acknowledges explicit release after native disposal and ignores repeated release and late callbacks', () => {
	const f = fixture({ explicit: true, initial: 1, callbackDuringDisposal: true })
	f.actor.send({ type: 'RELEASE' })
	expect(f.dispose).toHaveBeenCalledOnce()
	expect(f.reports()).toEqual([
		{ type: 'VALUE', binding: f.binding, value: 1 },
		{ type: 'RELEASED', binding: f.binding, outcome: 'released' }
	])
	f.actor.send({ type: 'RELEASE' })
	f.publish(2)
	f.failed()
	f.actor.send({ type: 'END' })
	expect(f.dispose).toHaveBeenCalledOnce()
	expect(f.reports()).toHaveLength(2)
})

it('reports unresolved explicit release when disposal or construction failed', () => {
	for (const options of [
		{ disposalError: new Error('Disposal failed') },
		{ constructionError: new Error('Acquisition failed') }
	]) {
		const f = fixture({ ...options, explicit: true })
		f.actor.send({ type: 'RELEASE' })
		expect(f.reports().at(-1)).toEqual({
			type: 'RELEASED',
			binding: f.binding,
			outcome: 'unresolved'
		})
		f.actor.send({ type: 'RELEASE' })
		f.actor.send({ type: 'END' })
		expect(f.reports().filter((report) => report.type === 'RELEASED')).toHaveLength(1)
	}
})

it('releases an absent optional source without fabricating data', () => {
	const f = fixture({ explicit: true, absent: true })
	f.actor.send({ type: 'RELEASE' })
	expect(f.reports()).toEqual([{ type: 'RELEASED', binding: f.binding, outcome: 'released' }])
	expect(f.dispose).not.toHaveBeenCalled()
})

it('keeps stop-only consumers silent when they have not opted into explicit receipts', () => {
	const f = fixture()
	f.actor.send({ type: 'RELEASE' })
	expect(f.dispose).not.toHaveBeenCalled()
	expect(f.reports()).toEqual([])
	f.actor.send({ type: 'END' })
	expect(f.dispose).toHaveBeenCalledOnce()
	expect(f.reports()).toEqual([])
})

it('does not turn stop into an explicit release receipt for an opted-in consumer', () => {
	const f = fixture({ explicit: true })
	f.actor.stop()
	expect(f.dispose).toHaveBeenCalledOnce()
	expect(f.reports()).toEqual([])
})

it('preserves explicit receipt and callback ordering across generated release/stop schedules', () => {
	fc.assert(
		fc.property(
			fc.array(
				fc.oneof(
					fc.integer({ min: 0, max: 20 }),
					fc.constant('failed'),
					fc.constant('release'),
					fc.constant('end')
				),
				{ maxLength: 30 }
			),
			(commands) => {
				const f = fixture({ explicit: true, callbackDuringDisposal: true })
				const expected: Report[] = []
				let closed = false
				try {
					for (const command of commands) {
						if (command === 'release') {
							if (!closed)
								expected.push({ type: 'RELEASED', binding: f.binding, outcome: 'released' })
							closed = true
							f.actor.send({ type: 'RELEASE' })
						} else if (command === 'end') {
							closed = true
							f.actor.send({ type: 'END' })
						} else if (command === 'failed') {
							if (!closed) expected.push({ type: 'FAILED', binding: f.binding })
							f.failed()
						} else {
							if (!closed) expected.push({ type: 'VALUE', binding: f.binding, value: command })
							f.publish(command)
						}
						expect(f.reports()).toEqual(expected)
						expect(f.dispose).toHaveBeenCalledTimes(closed ? 1 : 0)
					}
				} finally {
					f.actor.stop()
					actors.delete(f.actor)
				}
				expect(f.dispose).toHaveBeenCalledOnce()
				expect(f.reports()).toEqual(expected)
			}
		),
		{ seed: 20261126, numRuns: 100 }
	)
})
