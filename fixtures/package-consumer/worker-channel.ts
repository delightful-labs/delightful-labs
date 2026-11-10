import assert from 'node:assert/strict'
import { once } from 'node:events'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { createActor, setup, SimulatedClock, types, waitFor } from 'xstate'
import { createWorkerChannel } from 'delightful-local-first/worker/channel/workflow'
import type {
	WorkerChannelInput,
	WorkerChannelResult,
	WorkerHostClosed
} from 'delightful-local-first/worker/channel/contracts'
import type {
	WorkerRequestIdentity,
	WorkerRequestReply
} from 'delightful-local-first/worker/request/contracts'

type Request = { type: 'READ' } | { type: 'WRITE'; value: string }
type Response = { value: string | null; port?: MessagePort }
function deferred<Value>() {
	let resolve!: (value: Value) => void
	const promise = new Promise<Value>((accept) => {
		resolve = accept
	})
	return { promise, resolve }
}
async function bounded<Value>(promise: Promise<Value>): Promise<Value> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('Native channel fixture deadline exceeded')),
					1000
				)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}

const data = new MessageChannel(),
	control = new MessageChannel()
const scope = 'consumer-A-3',
	closeRequestId = 'close-consumer-A-3'
const writeObserved = deferred<void>(),
	closeObserved = deferred<WorkerHostClosed>()
const writeResult = deferred<WorkerChannelResult<Response>>()
let stored: string | null = null
let writes = 0,
	closePosts = 0,
	overdue = 0,
	dataDisposed = 0,
	controlDisposed = 0
const hostReceive = ({
	request,
	identity
}: {
	request: Request
	identity: WorkerRequestIdentity
}) => {
	assert.equal(identity.scope, scope)
	if (request.type === 'WRITE') {
		writes++
		stored = request.value
		writeObserved.resolve()
		// Deliberately lose the acknowledgement of a genuine synchronous effect.
		return
	}
	data.port1.postMessage({ identity, kind: 'succeeded', response: { value: stored } })
}
data.port1.on('message', hostReceive)
control.port1.on('message', (identity: WorkerHostClosed) => {
	assert.deepEqual(identity, { scope, requestId: closeRequestId })
	closePosts++
	// Actual host quiescence precedes any receipt. The independent control
	// transport remains alive so the delayed receipt can still be delivered.
	data.port1.off('message', hostReceive)
	data.port1.close()
	closeObserved.resolve(identity)
})
const input: WorkerChannelInput<Request, Response> = {
	scope,
	closeRequestId,
	requestTimeoutMs: 5,
	closeTimeoutMs: 10,
	post: (request, identity) => {
		data.port2.postMessage({ request, identity })
		return { kind: 'posted' }
	},
	listenData(report) {
		const receive = (reply: WorkerRequestReply<Response>) => report({ type: 'REPLY', reply })
		data.port2.on('message', receive)
		return () => {
			dataDisposed++
			data.port2.off('message', receive)
			data.port2.close()
		}
	},
	listenControl(report) {
		const receive = (receipt: WorkerHostClosed) => report({ type: 'HOST_CLOSED', receipt })
		control.port2.on('message', receive)
		return () => {
			controlDisposed++
			control.port2.off('message', receive)
			control.port2.close()
		}
	},
	postClose: (identity) => control.port2.postMessage(identity),
	discard: (response) => response.port?.close(),
	onOverdue: () => {
		overdue++
	},
	onBlocked: () => assert.fail('Unexpected channel failure')
}
const channel = createWorkerChannel<Request, Response>()
type Context = { record: { configuration: typeof input; receipt: WorkerHostClosed | undefined } }
const parent = setup({
	schemas: {
		context: types<Context>(),
		input: types<typeof input>(),
		events: { RUN: types(), CLOSE: types() },
		children: { channel: types<import('xstate').ActorRefFrom<typeof channel>>() }
	},
	actors: { channel }
}).createMachine({
	context: ({ input }) => ({ record: { configuration: input, receipt: undefined } }),
	initial: 'running',
	states: {
		running: {
			invoke: {
				id: 'channel',
				src: 'channel',
				input: ({ context }) => context.record.configuration,
				onDone: ({ context, event }) => ({
					target: 'closed',
					context: { record: { ...context.record, receipt: event.output } }
				}),
				onError: { target: 'failed' }
			},
			on: {
				RUN: (_, enq) =>
					enq.sendTo('channel', {
						type: 'REQUEST',
						call: {
							requestId: 'write',
							request: { type: 'WRITE', value: 'persisted-before-lost-reply' },
							effect: 'effect',
							accept: () => true,
							settle: writeResult.resolve
						}
					}),
				CLOSE: (_, enq) => enq.sendTo('channel', { type: 'CLOSE' })
			}
		},
		closed: { type: 'final' },
		failed: { type: 'final' }
	}
})
const clock = new SimulatedClock()
const actor = createActor(parent, { input, clock })
function checkPrivateReports() {
	const ref = createActor(channel, { input })
	ref.send({
		// @ts-expect-error Wire reports are delivered only by the injected native listener.
		type: 'REPLY',
		reply: {
			kind: 'succeeded',
			identity: { scope, requestId: 'write', sequence: 1 },
			response: { value: null }
		}
	})
	ref.send({
		// @ts-expect-error Child completion reports cannot be forged through the public protocol.
		type: 'REQUEST_DONE',
		identity: { scope, requestId: 'write', sequence: 1 },
		result: undefined
	})
	// @ts-expect-error A host-close receipt comes from the independent control capability.
	ref.send({ type: 'HOST_CLOSED', receipt: { scope, requestId: closeRequestId } })
	ref.stop()
}
void checkPrivateReports
actor.start()
try {
	// Real transferred resource, unknown request: its peer must actually close.
	const orphan = new MessageChannel()
	const orphanClosed = once(orphan.port2, 'close', { signal: AbortSignal.timeout(1000) })
	data.port1.postMessage(
		{
			kind: 'succeeded',
			identity: { scope, requestId: 'unknown', sequence: 99 },
			response: { value: null, port: orphan.port1 }
		},
		[orphan.port1]
	)
	await orphanClosed
	orphan.port2.close()
	actor.send({ type: 'RUN' })
	await bounded(writeObserved.promise)
	clock.increment(5)
	const result = await bounded(writeResult.promise)
	assert.deepEqual(result, {
		kind: 'failed',
		identity: { scope, requestId: 'write', sequence: 1 },
		reason: 'timeout',
		effectOutcome: 'unknown'
	})
	await bounded(closeObserved.promise)
	clock.increment(10)
	assert.equal(overdue, 1)
	assert.equal(actor.getSnapshot().status, 'active')
	assert.equal(actor.getSnapshot().context.record.receipt, undefined)
	assert.equal(controlDisposed, 0)
	control.port1.postMessage({ scope: 'consumer-A-1', requestId: closeRequestId })
	control.port1.postMessage({ scope, requestId: 'wrong-close' })
	control.port1.postMessage({ scope, requestId: closeRequestId })
	await waitFor(actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	assert.deepEqual(actor.getSnapshot().context.record.receipt, { scope, requestId: closeRequestId })
	assert.equal(writes, 1)
	assert.equal(closePosts, 1)
	assert.equal(stored, 'persisted-before-lost-reply')
	assert.equal(dataDisposed, 1)
	assert.equal(controlDisposed, 1)
} finally {
	actor.stop()
	data.port1.close()
	data.port2.close()
	control.port1.close()
	control.port2.close()
}
console.log(
	'Worker channel consumer: native transfer cleanup, unknown write and late scoped closure passed.'
)
