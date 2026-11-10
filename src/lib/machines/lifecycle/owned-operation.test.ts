import { createActor, createAsyncLogic, createCallbackLogic, setup, toPromise, types } from 'xstate'
import type { EventFrom, SnapshotFrom } from 'xstate'
import { afterEach, expect, it, vi } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { createOwnedOperation } from './owned-operation.js'

type Control = { type: 'SHUTDOWN' | 'CANCEL' }
type Input = { operationId: string; binding: { account: string; generation: number } }
const running = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of running) actor.stop()
	running.clear()
})

function fixture<Output>(
	output: Output,
	options: { spawnError?: Error; startError?: Error; subscribeError?: Error } = {}
) {
	const completion = Promise.withResolvers<Output>()
	const started = vi.fn<(input: Input) => void>()
	const commands = vi.fn<(command: Control) => void>()
	const opened = vi.fn()
	const closed = vi.fn()
	const unsubscribed = vi.fn()
	const work = createAsyncLogic({ run: () => completion.promise })
	const resource = createCallbackLogic<never>(() => {
		opened()
		return () => closed()
	})
	const child = setup({
		schemas: {
			context: types<Input>(),
			input: types<Input>(),
			output: types<Output>(),
			events: { SHUTDOWN: types(), CANCEL: types() }
		},
		actors: { work, resource }
	}).createMachine({
		context: ({ input }) => input,
		initial: 'working',
		output: () => output,
		states: {
			working: {
				entry: ({ context }, enq) => {
					enq(started, context)
					if (options.startError)
						enq(() => {
							throw options.startError
						})
				},
				invoke: [
					{ id: 'resource', src: 'resource' },
					{ id: 'work', src: 'work', onDone: { target: 'done' } }
				],
				on: {
					SHUTDOWN: ({ event }, enq) => enq(commands, event),
					CANCEL: ({ event }, enq) => enq(commands, event)
				}
			},
			done: { type: 'final' }
		}
	})
	const logic = createOwnedOperation<Input, Output, Control>()
	const input: Input = { operationId: 'operation', binding: { account: 'A', generation: 7 } }
	const actor = createActor(logic, {
		input: {
			operationId: input.operationId,
			input,
			spawn: (spawn, request) => {
				if (options.spawnError) throw options.spawnError
				const ref = spawn(child, { id: 'selected', input: request })
				const subscribe = ref.subscribe.bind(ref)
				vi.spyOn(ref, 'subscribe').mockImplementation((observer) => {
					if (options.subscribeError) throw options.subscribeError
					const subscription = subscribe(observer)
					return {
						unsubscribe: () => {
							unsubscribed()
							subscription.unsubscribe()
						}
					}
				})
				return ref
			}
		}
	})
	running.add(actor)
	return {
		actor,
		input,
		started,
		commands,
		opened,
		closed,
		unsubscribed,
		completion,
		result: toPromise(actor)
	}
}

it('passes the exact operation input once and preserves the output and receipt identity', async () => {
	const output = { settlement: { kind: 'locallyPersisted', receipt: { global: vi.fn() } } }
	const f = fixture(output)
	f.actor.start()
	expect(f.started).toHaveBeenCalledOnce()
	expect(f.started.mock.calls[0]![0]).toBe(f.input)
	expect(f.opened).toHaveBeenCalledOnce()
	expect(f.closed).not.toHaveBeenCalled()
	f.completion.resolve(output)
	const result = await f.result
	expect(result).toEqual({ kind: 'completed', operationId: 'operation', output })
	expect(result.kind === 'completed' && result.output).toBe(output)
	expect(output.settlement.receipt.global).not.toHaveBeenCalled()
	expect(f.commands).not.toHaveBeenCalled()
	expect(f.closed).toHaveBeenCalledOnce()
})

it('allows a child to complete with undefined output', async () => {
	const f = fixture(undefined)
	f.actor.start()
	f.completion.resolve(undefined)
	expect(await f.result).toEqual({ kind: 'completed', operationId: 'operation', output: undefined })
})

it('captures a child that completes synchronously during startup', async () => {
	const output = { id: 'immediate receipt' }
	const child = setup({ schemas: { output: types<typeof output>() } }).createMachine({
		initial: 'done',
		output: () => output,
		states: { done: { type: 'final' } }
	})
	const actor = createActor(createOwnedOperation<undefined, typeof output>(), {
		input: { operationId: 'immediate', input: undefined, spawn: (spawn) => spawn(child) }
	})
	running.add(actor)
	const result = toPromise(actor)
	actor.start()
	expect(await result).toEqual({ kind: 'completed', operationId: 'immediate', output })
})

it('refuses a report for a different child without releasing the current operation', async () => {
	const f = fixture('original receipt')
	f.actor.start()
	const controller = f.actor.getSnapshot().children.controller!
	controller.send({ type: 'CHILD_DONE', actorId: 'other-child', output: 'forged receipt' })
	controller.send({ type: 'CHILD_ERROR', actorId: 'other-child', error: new Error('stale error') })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.closed).not.toHaveBeenCalled()
	f.completion.resolve('original receipt')
	expect(await f.result).toEqual({
		kind: 'completed',
		operationId: 'operation',
		output: 'original receipt'
	})
})

for (const first of ['DRAIN', 'SHUTDOWN', 'CANCEL'] as const) {
	it(`keeps the child alive after ${first}, forwarding at most one supported command`, async () => {
		const output = { settlement: { kind: 'unresolved' } }
		const f = fixture(output)
		f.actor.start()
		f.actor.send(
			first === 'DRAIN' ? { type: 'DRAIN' } : { type: 'INTERRUPT', command: { type: first } }
		)
		for (let repeat = 0; repeat < 3; repeat++) {
			f.actor.send({ type: 'DRAIN' })
			f.actor.send({ type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
			f.actor.send({ type: 'INTERRUPT', command: { type: 'CANCEL' } })
		}
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.started).toHaveBeenCalledOnce()
		expect(f.closed).not.toHaveBeenCalled()
		expect(f.commands.mock.calls.map(([command]) => command.type)).toEqual(
			first === 'DRAIN' ? [] : [first]
		)
		f.completion.resolve(output)
		const result = await f.result
		expect(result.kind === 'completed' && result.output).toBe(output)
		expect(f.closed).toHaveBeenCalledOnce()
	})
}

for (const type of ['SHUTDOWN', 'CANCEL'] as const) {
	it(`delivers a pre-start ${type} request to one admitted child without completing early`, async () => {
		const f = fixture('receipt')
		f.actor.send({ type: 'INTERRUPT', command: { type } })
		f.actor.send({ type: 'INTERRUPT', command: { type } })
		f.actor.start()
		expect(f.started).toHaveBeenCalledOnce()
		expect(f.commands).toHaveBeenCalledExactlyOnceWith({ type })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.completion.resolve('receipt')
		expect((await f.result).kind).toBe('completed')
	})
}

it('waits after a pre-start drain without forwarding a later cancellation', async () => {
	const f = fixture('receipt')
	f.actor.send({ type: 'DRAIN' })
	f.actor.send({ type: 'INTERRUPT', command: { type: 'CANCEL' } })
	f.actor.start()
	expect(f.commands).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().status).toBe('active')
	f.completion.resolve('receipt')
	await f.result
})

for (const phase of ['spawn', 'start', 'subscription', 'async'] as const) {
	it(`returns original ${phase} failure facts without restarting or leaking a subscription`, async () => {
		const error = new Error(`${phase} failed`)
		const f = fixture('receipt', {
			...(phase === 'spawn' ? { spawnError: error } : {}),
			...(phase === 'start' ? { startError: error } : {}),
			...(phase === 'subscription' ? { subscribeError: error } : {})
		})
		f.actor.start()
		if (phase === 'async') f.completion.reject(error)
		expect(await f.result).toEqual({ kind: 'failed', operationId: 'operation', error })
		expect(Object.keys(f.actor.getSnapshot().children)).toHaveLength(0)
		expect(f.commands).not.toHaveBeenCalled()
		expect(f.started).toHaveBeenCalledTimes(phase === 'spawn' ? 0 : 1)
		expect(f.closed.mock.calls).toHaveLength(f.opened.mock.calls.length)
		if (phase === 'async') expect(f.closed).toHaveBeenCalledOnce()
	})
}

it('releases child and subscription refs without changing an earlier snapshot', async () => {
	const f = fixture('receipt')
	f.actor.start()
	const controller = f.actor.getSnapshot().children.controller!
	const earlier = controller.getSnapshot()
	const { child, subscription } = earlier.context.ownership
	expect(child).toBeDefined()
	expect(subscription).toBeDefined()
	f.completion.resolve('receipt')
	await f.result
	expect(controller.getSnapshot().context.ownership).toEqual({
		child: undefined,
		subscription: undefined
	})
	expect(earlier.context.ownership.child).toBe(child)
	expect(earlier.context.ownership.subscription).toBe(subscription)
	expect(subscription!.getSnapshot().status).not.toBe('active')
	expect(f.unsubscribed).toHaveBeenCalledOnce()
	expect(Object.keys(controller.getSnapshot().children)).toHaveLength(0)
})

it('force-stop releases the child resource and a late completion cannot publish a result', async () => {
	const f = fixture('late receipt')
	f.actor.start()
	const controller = f.actor.getSnapshot().children.controller!
	expect(controller.getSnapshot().context.ownership.subscription).toBeDefined()
	f.actor.stop()
	expect(f.closed).toHaveBeenCalledOnce()
	// Attached actors tear down on parent completion even though this beta can
	// retain an active snapshot on the helper ref. Assert the actual disposer.
	expect(f.unsubscribed).toHaveBeenCalledOnce()
	f.completion.resolve('late receipt')
	await Promise.resolve()
	await Promise.resolve()
	expect(f.actor.getSnapshot().status).toBe('stopped')
	expect(f.actor.getSnapshot().output).toBeUndefined()
	expect(f.commands).not.toHaveBeenCalled()
})

it('stopping before startup prevents native work and a later start cannot issue it', () => {
	const f = fixture('receipt')
	f.actor.stop()
	expect(() => f.actor.start()).toThrow(/cannot be restarted/)
	expect(f.started).not.toHaveBeenCalled()
	expect(f.opened).not.toHaveBeenCalled()
	expect(f.commands).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().output).toBeUndefined()
})

it('can() calculations do not deliver commands, start another child or change prior snapshots', async () => {
	const f = fixture('receipt')
	const initial = f.actor.getSnapshot()
	for (let attempt = 0; attempt < 3; attempt++) {
		expect(initial.can({ type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })).toBe(true)
		expect(initial.can({ type: 'DRAIN' })).toBe(true)
	}
	expect(f.started).not.toHaveBeenCalled()
	expect(f.commands).not.toHaveBeenCalled()
	f.actor.start()
	const active = f.actor.getSnapshot()
	for (let attempt = 0; attempt < 3; attempt++) {
		expect(active.can({ type: 'INTERRUPT', command: { type: 'CANCEL' } })).toBe(true)
	}
	expect(f.actor.getSnapshot()).toBe(active)
	expect(f.started).toHaveBeenCalledOnce()
	expect(f.commands).not.toHaveBeenCalled()
	f.completion.resolve('receipt')
	await f.result
})

for (const settlement of ['completion', 'failure'] as const) {
	it(`handles ${settlement} racing interruption without losing the original result`, async () => {
		const output = { id: 'receipt' }
		const error = new Error('racing failure')
		const f = fixture(output)
		f.actor.start()
		if (settlement === 'completion') f.completion.resolve(output)
		else f.completion.reject(error)
		f.actor.send({ type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
		f.actor.send({ type: 'INTERRUPT', command: { type: 'CANCEL' } })
		const result = await f.result
		expect(result).toEqual(
			settlement === 'completion'
				? { kind: 'completed', operationId: 'operation', output }
				: { kind: 'failed', operationId: 'operation', error }
		)
		expect(f.commands).toHaveBeenCalledExactlyOnceWith({ type: 'SHUTDOWN' })
		expect(f.started).toHaveBeenCalledOnce()
		expect(f.closed).toHaveBeenCalledOnce()
		expect(f.unsubscribed).toHaveBeenCalledOnce()
	})
}

// This oracle records external requests and settlement facts. It does not
// reproduce the supervisor's private controller, actors or subscription graph.
const contract = setup({
	schemas: {
		context: types<{ requests: ('DRAIN' | 'SHUTDOWN' | 'CANCEL')[] }>(),
		events: {
			REQUEST: types<{ kind: 'DRAIN' | 'SHUTDOWN' | 'CANCEL' }>(),
			COMPLETE: types(),
			REJECT: types()
		}
	}
}).createMachine({
	context: { requests: [] },
	initial: 'pending',
	states: {
		pending: {
			on: {
				REQUEST: ({ context, event }) => ({
					context: { requests: [...context.requests, event.kind] }
				}),
				COMPLETE: { target: 'completed' },
				REJECT: { target: 'failed' }
			}
		},
		completed: { on: { REQUEST: {}, COMPLETE: {}, REJECT: {} } },
		failed: { on: { REQUEST: {}, COMPLETE: {}, REJECT: {} } }
	}
})
type Observation = { commands: string[]; status: string; started: number; closed: number }
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create() {
		const f = fixture('receipt')
		f.actor.start()
		let status = 'pending'
		return {
			async send(event) {
				if (status !== 'pending') return
				if (event.type === 'REQUEST') {
					f.actor.send(
						event.kind === 'DRAIN'
							? { type: 'DRAIN' }
							: { type: 'INTERRUPT', command: { type: event.kind } }
					)
					return
				}
				if (event.type === 'COMPLETE') f.completion.resolve('receipt')
				else f.completion.reject(new Error('generated failure'))
				const result = await f.result
				status = result.kind
			},
			read: (): Observation => ({
				commands: f.commands.mock.calls.map(([command]) => command.type),
				status,
				started: f.started.mock.calls.length,
				closed: f.closed.mock.calls.length
			}),
			dispose: () => {
				f.actor.stop()
				running.delete(f.actor)
			}
		}
	},
	projectModel: (snapshot): Observation => ({
		commands:
			snapshot.context.requests[0] && snapshot.context.requests[0] !== 'DRAIN'
				? [snapshot.context.requests[0]]
				: [],
		status: String(snapshot.value),
		started: 1,
		closed: snapshot.matches('pending') ? 0 : 1
	})
}
it('matches generated drain, interruption, duplicate and settlement sequences', async () => {
	const { coverage } = await propertyTest(contract, {
		events: {
			REQUEST: fc.record({ kind: fc.constantFrom('DRAIN', 'SHUTDOWN', 'CANCEL') }),
			COMPLETE: fc.constant({}),
			REJECT: fc.constant({})
		},
		sut,
		seed: 20261111,
		numRuns: 300,
		maxCommands: 12,
		failures: { key: 'owned-operation-lifecycle' }
	})
	assertTestCoverage(coverage, { eventTypes: 1, stateNodes: 1, transitions: 1 })
})
