import assert from 'node:assert/strict'
import { createActor, setup, types, waitFor } from 'xstate'
import { createWorkerRequest } from 'delightful-local-first/worker/request/workflow'
import {
	DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
	type WorkerRequestIdentity,
	type WorkerRequestInput,
	type WorkerRequestReply,
	type WorkerRequestResult
} from 'delightful-local-first/worker/request/contracts'

type Request = { key: string; value: string }
type Response = { receipt: string }
type Call = WorkerRequestInput<Request>
type Context = { record: { selected: Call | undefined; results: WorkerRequestResult<Response>[] } }
const request = createWorkerRequest<Request, Response>()
const parent = setup({
	schemas: {
		context: types<Context>(),
		events: {
			RUN: types<{ call: Call }>(),
			REPLY: types<{ reply: WorkerRequestReply<Response> }>()
		},
		children: { request: types<import('xstate').ActorRefFrom<typeof request>>() }
	},
	actors: { request }
}).createMachine({
	context: { record: { selected: undefined, results: [] } },
	initial: 'idle',
	states: {
		idle: {
			on: {
				RUN: ({ context, event }) => ({
					target: 'running',
					context: { record: { ...context.record, selected: event.call } }
				})
			}
		},
		running: {
			invoke: {
				id: 'request',
				src: 'request',
				input: ({ context }) => context.record.selected!,
				onDone: ({ context, event }) => ({
					target: 'idle',
					context: {
						record: { selected: undefined, results: [...context.record.results, event.output] }
					}
				}),
				onError: { target: 'unexpectedFailure' }
			},
			on: { REPLY: ({ event }, enq) => enq.sendTo('request', event) }
		},
		unexpectedFailure: { type: 'final' }
	}
})

const identities: WorkerRequestIdentity[] = [
	{ scope: 'A-1', requestId: 'reused-id', sequence: 1 },
	{ scope: 'B-2', requestId: 'reused-id', sequence: 1 },
	{ scope: 'A-3', requestId: 'reused-id', sequence: 1 }
]
const observed: { payload: Request; identity: WorkerRequestIdentity }[] = []
const actor = createActor(parent)
const boundary = createActor(request, {
	input: {
		identity: identities[0]!,
		request: { key: 'account', value: 'value' },
		effect: 'effect',
		post: () => ({ kind: 'posted' })
	}
})
function checkPublicProtocol() {
	boundary.send({ type: 'TRANSPORT_FAILED', scope: 'A-1', reason: 'closed' })
	boundary.send({
		type: 'REPLY',
		// @ts-expect-error A reply needs all three identity components.
		reply: { kind: 'succeeded', identity: { requestId: 'id' }, response: { receipt: 'ok' } }
	})
	boundary.send({
		type: 'REPLY',
		reply: {
			kind: 'failed',
			identity: identities[0]!,
			reason: 'rejected',
			// @ts-expect-error Peer evidence cannot claim a rolled-back write.
			effectOutcome: 'rolled-back'
		}
	})
	boundary.send({
		type: 'REPLY',
		// @ts-expect-error The selected response contract is retained in public declarations.
		reply: { kind: 'succeeded', identity: identities[0]!, response: 123 }
	})
	// @ts-expect-error The request primitive does not promise cancellation of a native effect.
	boundary.send({ type: 'CANCEL' })
}
void checkPublicProtocol
assert.equal(DEFAULT_WORKER_REQUEST_TIMEOUT_MS, 10_000)
actor.start()
try {
	for (const [index, identity] of identities.entries()) {
		const payload = { key: 'account', value: `value-${index}` }
		const call: Call = {
			identity,
			request: payload,
			effect: 'effect',
			timeoutMs: 1000,
			post: (selected, selectedIdentity) => {
				observed.push({ payload: selected, identity: selectedIdentity })
				return { kind: 'posted' }
			}
		}
		const before = actor.getSnapshot()
		assert.equal(before.can({ type: 'RUN', call }), true)
		assert.equal(actor.getSnapshot(), before)
		assert.equal(observed.length, index)
		actor.send({ type: 'RUN', call })
		assert.equal(observed[index]!.payload, payload)
		assert.equal(observed[index]!.identity, identity)
		const stale = { ...identity, scope: 'A-0' }
		actor.send({
			type: 'REPLY',
			reply: { kind: 'succeeded', identity: stale, response: { receipt: 'stale' } }
		})
		assert.equal(actor.getSnapshot().matches('running'), true)
		const response = { receipt: `receipt-${index}` }
		actor.send({ type: 'REPLY', reply: { kind: 'succeeded', identity, response } })
		await waitFor(actor, (snapshot) => snapshot.matches('idle'), { timeout: 1000 })
		const result = actor.getSnapshot().context.record.results[index]!
		assert.equal(result.identity, identity)
		assert.equal(result.kind, 'succeeded')
		if (result.kind === 'succeeded') assert.equal(result.response, response)
		assert.equal(actor.getSnapshot().context.record.selected, undefined)
	}
	assert.equal(observed.length, 3)
} finally {
	actor.stop()
	boundary.stop()
}
console.log('Worker request consumer: public types, correlation and A → B → A invocation passed.')
