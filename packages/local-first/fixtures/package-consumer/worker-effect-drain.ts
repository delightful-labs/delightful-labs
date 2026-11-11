import assert from 'node:assert/strict'
import { locks } from 'node:worker_threads'
import { setImmediate } from 'node:timers/promises'
import { createActor, createAsyncLogic, setup, SimulatedClock, types, waitFor } from 'xstate'
import { createWorkerEffectDrain } from 'delightful-local-first/worker/effect-drain/workflow'
import type {
	WorkerEffectDrainInput,
	WorkerEffectProof,
	WorkerEffectSettlement
} from 'delightful-local-first/worker/effect-drain/contracts'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'

function deferred<Value>() {
	let resolve!: (value: Value) => void
	const promise = new Promise<Value>((accept) => {
		resolve = accept
	})
	return { promise, resolve }
}
async function bounded<Value>(promise: Promise<Value>) {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('Native lock fixture deadline exceeded')), 1000)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}
const key = `worker-effect-drain-${crypto.randomUUID()}`
const identity = { scope: 'A-3', requestId: 'close-original' }
const acquired = deferred<void>(),
	release = deferred<void>()
const native = deferred<WorkerEffectSettlement>(),
	host = deferred<WorkerHostClosed>()
const held = locks.request(key, async () => {
	acquired.resolve()
	await release.promise
})
await bounded(acquired.promise)
let competitorEntered = false,
	closePosts = 0,
	overdue = 0
const competitor = locks.request(key, () => {
	competitorEntered = true
})
const input: WorkerEffectDrainInput = {
	identity,
	settlement: native.promise,
	hostClosed: host.promise,
	deadlineMs: 5,
	requestClose: () => {
		closePosts++
	},
	onOverdue: () => {
		overdue++
	}
}
const drain = createWorkerEffectDrain()
const released = createAsyncLogic<void, Promise<void>>({ run: ({ input }) => input })
type Context = { record: { input: WorkerEffectDrainInput; proof: WorkerEffectProof | undefined } }
const parent = setup({
	schemas: {
		context: types<Context>(),
		input: types<WorkerEffectDrainInput>(),
		children: {
			drain: types<import('xstate').ActorRefFrom<typeof drain>>(),
			released: types<import('xstate').ActorRefFrom<typeof released>>()
		}
	},
	actors: { drain, released }
}).createMachine({
	context: ({ input }) => ({ record: { input, proof: undefined } }),
	initial: 'holding',
	states: {
		holding: {
			invoke: {
				id: 'drain',
				src: 'drain',
				input: ({ context }) => context.record.input,
				onDone: ({ context, event }, enq) => {
					enq(() => release.resolve())
					return {
						target: 'releasing',
						context: { record: { ...context.record, proof: event.output } }
					}
				},
				onError: { target: 'blocked' }
			}
		},
		releasing: {
			invoke: {
				id: 'released',
				src: 'released',
				input: () => held,
				onDone: { target: 'done' },
				onError: { target: 'blocked' }
			}
		},
		blocked: {},
		done: { type: 'final' }
	}
})
const clock = new SimulatedClock(),
	actor = createActor(parent, { input, clock })
actor.start()
try {
	native.resolve({ kind: 'uncertain' })
	await setImmediate()
	clock.increment(5)
	assert.equal(overdue, 1)
	assert.equal(closePosts, 1)
	assert.equal(actor.getSnapshot().status, 'active')
	assert.equal(competitorEntered, false)
	const snapshot = await locks.query()
	assert.equal(snapshot.held.filter((lock) => lock.name === key).length, 1)
	assert.equal(snapshot.pending.filter((lock) => lock.name === key).length, 1)
	host.resolve(identity)
	await waitFor(actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	await bounded(competitor)
	assert.equal(competitorEntered, true)
	assert.deepEqual(actor.getSnapshot().context.record.proof, {
		kind: 'host-closed',
		receipt: identity
	})
	assert.equal(closePosts, 1)
} finally {
	actor.stop()
	release.resolve()
	await bounded(Promise.allSettled([held, competitor]))
}
console.log(
	'Worker effect drain consumer: actual Web Lock retained past deadline until scoped closure proof.'
)
