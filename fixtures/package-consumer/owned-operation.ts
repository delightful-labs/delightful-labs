import assert from 'node:assert/strict'
import { createActor, createAsyncLogic, setup, types, waitFor } from 'xstate'
import { createOwnedOperation } from 'delightful-local-first/lifecycle/operation/workflow'
import type {
	OwnedOperationCommand,
	OwnedOperationResult
} from 'delightful-local-first/lifecycle/operation/contracts'

type Input = { operationId: string; binding: { account: string; generation: number } }
type Receipt = { id: string }
function deferred<Value>() {
	let resolve!: (value: Value) => void
	const promise = new Promise<Value>((accept) => {
		resolve = accept
	})
	return { promise, resolve }
}
const inputs: Input[] = []
const commands: number[] = []
const gates = new Map<number, ReturnType<typeof deferred<Receipt>>>()
const work = createAsyncLogic({
	run: ({ input }: { input: Input }) => {
		inputs.push(input)
		return gates.get(input.binding.generation)!.promise
	}
})
const child = setup({
	schemas: {
		context: types<{ input: Input; receipt: Receipt | undefined }>(),
		input: types<Input>(),
		output: types<Receipt>(),
		events: { SHUTDOWN: types() }
	},
	actors: { work }
}).createMachine({
	context: ({ input }) => ({ input, receipt: undefined }),
	initial: 'working',
	output: ({ context }) => context.receipt!,
	states: {
		working: {
			invoke: {
				id: 'work',
				src: 'work',
				input: ({ context }) => context.input,
				onDone: ({ event }) => ({ target: 'done', context: { receipt: event.output } })
			},
			on: {
				SHUTDOWN: ({ context }, enq) => {
					enq(() => commands.push(context.input.binding.generation))
				}
			}
		},
		done: { type: 'final' }
	}
})
const operation = createOwnedOperation<Input, Receipt, { type: 'SHUTDOWN' }>()
type Context = { request: Input | undefined; results: OwnedOperationResult<Receipt>[] }
const parent = setup({
	schemas: {
		context: types<Context>(),
		events: { RUN: types<{ request: Input }>(), SHUTDOWN: types() },
		children: { operation: types<import('xstate').ActorRefFrom<typeof operation>>() }
	},
	actors: { operation }
}).createMachine({
	context: { request: undefined, results: [] },
	initial: 'idle',
	states: {
		idle: {
			on: { RUN: ({ event }) => ({ target: 'running', context: { request: event.request } }) }
		},
		running: {
			invoke: {
				id: 'operation',
				src: 'operation',
				input: ({ context }) => ({
					operationId: context.request!.operationId,
					input: context.request!,
					spawn: (spawn, input) => spawn(child, { input })
				}),
				onDone: ({ context, event }) => ({
					target: 'idle',
					context: { request: undefined, results: [...context.results, event.output] }
				})
			},
			on: {
				SHUTDOWN: (_, enq) =>
					enq.sendTo('operation', { type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
			}
		}
	}
})

const requests: Input[] = [
	{ operationId: 'same-operation', binding: { account: 'A', generation: 1 } },
	{ operationId: 'same-operation', binding: { account: 'B', generation: 2 } },
	{ operationId: 'same-operation', binding: { account: 'A', generation: 3 } }
]
const standaloneInput = {
	operationId: 'type-boundary',
	input: requests[0]!,
	spawn: (
		spawn: import('delightful-local-first/lifecycle/operation/contracts').OperationChildSpawner,
		input: Input
	) => spawn(child, { input })
}
const shutdownOnly = createActor(operation, { input: standaloneInput })
const drainOnly = createActor(createOwnedOperation<Input, Receipt>(), { input: standaloneInput })
function checkPublicProtocol() {
	const supported: OwnedOperationCommand<{ type: 'SHUTDOWN' }> = {
		type: 'INTERRUPT',
		command: { type: 'SHUTDOWN' }
	}
	shutdownOnly.send(supported)
	drainOnly.send({ type: 'DRAIN' })
	// @ts-expect-error The concrete child has no cancellation command.
	shutdownOnly.send({ type: 'INTERRUPT', command: { type: 'CANCEL' } })
	// @ts-expect-error Drain-only owners cannot command the child.
	drainOnly.send({ type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
	// @ts-expect-error Lifecycle completion reports stay in the private controller.
	shutdownOnly.send({ type: 'CHILD_DONE', actorId: 'child', output: { id: 'forged' } })
	// @ts-expect-error Lifecycle failure reports stay in the private controller.
	shutdownOnly.send({ type: 'CHILD_ERROR', actorId: 'child', error: 'forged' })
}
void checkPublicProtocol

const actor = createActor(parent)
actor.start()
try {
	for (const [index, request] of requests.entries()) {
		const gate = deferred<Receipt>()
		gates.set(request.binding.generation, gate)
		const before = actor.getSnapshot()
		assert.equal(before.can({ type: 'RUN', request }), true)
		assert.equal(actor.getSnapshot(), before)
		assert.equal(inputs.length, index)
		actor.send({ type: 'RUN', request })
		assert.equal(inputs.length, index + 1)
		assert.equal(inputs[index], request)
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'SHUTDOWN' })
		assert.deepEqual(
			commands,
			requests.slice(0, index + 1).map((value) => value.binding.generation)
		)
		assert.equal(actor.getSnapshot().matches('running'), true)
		const receipt = { id: `receipt-${request.binding.generation}` }
		gate.resolve(receipt)
		await waitFor(actor, (snapshot) => snapshot.matches('idle'), { timeout: 1000 })
		const result = actor.getSnapshot().context.results[index]!
		assert.equal(result.operationId, request.operationId)
		assert.equal(result.kind, 'completed')
		if (result.kind === 'completed') assert.equal(result.output, receipt)
	}
} finally {
	actor.stop()
	shutdownOnly.stop()
	drainOnly.stop()
}
console.log('Owned operation consumer: public types and A → B → A invocation inputs passed.')
