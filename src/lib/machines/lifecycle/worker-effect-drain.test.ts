/// <reference lib="es2024.promise" />
import { createActor, setup, SimulatedClock, types, waitFor } from 'xstate'
import type { EventFrom, SnapshotFrom } from 'xstate'
import { afterEach, expect, it, vi } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { createWorkerEffectDrain } from './worker-effect-drain.js'
import type { WorkerHostClosed } from '../../contracts/worker-channel.js'
import type { WorkerEffectSettlement } from '../../contracts/worker-effect-drain.js'

const running = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of running) actor.stop()
	running.clear()
})
function fixture(deadlineMs = 5, closeError = false) {
	const native = Promise.withResolvers<WorkerEffectSettlement>()
	const host = Promise.withResolvers<WorkerHostClosed>()
	const identity = { scope: 'A-3', requestId: 'close-original' }
	const requestClose = vi.fn(() => {
		if (closeError) throw new Error('post-close failure')
	})
	const onOverdue = vi.fn(),
		clock = new SimulatedClock()
	const input = {
		identity,
		settlement: native.promise,
		hostClosed: host.promise,
		requestClose,
		onOverdue,
		deadlineMs
	}
	const actor = createActor(createWorkerEffectDrain(), { input, clock })
	running.add(actor)
	return { actor, input, native, host, identity, requestClose, onOverdue, clock }
}
async function flush() {
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
}

it('native quiescence proves drain without claiming an unknown operation succeeded', async () => {
	const f = fixture()
	f.actor.start()
	const before = f.actor.getSnapshot()
	f.native.resolve({ kind: 'settled' })
	await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	expect(f.actor.getSnapshot().output).toEqual({ kind: 'settled' })
	expect(f.actor.getSnapshot().context.record.input).toBeUndefined()
	expect(before.context.record.input).toBe(f.input)
	expect(before.context.record.proof).toBeUndefined()
	expect(f.requestClose).toHaveBeenCalledOnce()
})

it.each(['uncertain', 'rejected'] as const)(
	'native %s evidence keeps host-close custody alive past the deadline',
	async (outcome) => {
		const f = fixture()
		f.actor.start()
		if (outcome === 'uncertain') f.native.resolve({ kind: 'uncertain' })
		else f.native.reject(new Error('lost observer'))
		await flush()
		f.clock.increment(5)
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.actor.getSnapshot().output).toBeUndefined()
		expect(f.onOverdue).toHaveBeenCalledOnce()
		f.host.resolve(f.identity)
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
		expect(f.actor.getSnapshot().output).toEqual({ kind: 'host-closed', receipt: f.identity })
		const output = f.actor.getSnapshot().output
		if (output?.kind === 'host-closed') expect(output.receipt).toBe(f.identity)
		expect(f.requestClose).toHaveBeenCalledOnce()
	}
)

it.each(['scope', 'requestId'] as const)(
	'rejects a stale %s closure receipt while awaiting native evidence',
	async (field) => {
		const f = fixture()
		f.actor.start()
		f.host.resolve({ ...f.identity, [field]: 'old' })
		await flush()
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.onOverdue).toHaveBeenCalledOnce()
		f.native.resolve({ kind: 'settled' })
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
		expect(f.actor.getSnapshot().output).toEqual({ kind: 'settled' })
	}
)

it('a host observer failure retains a late native proof', async () => {
	const f = fixture()
	f.actor.start()
	f.host.reject(new Error('host observer unavailable'))
	await flush()
	expect(f.onOverdue).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().output).toBeUndefined()
	f.native.resolve({ kind: 'settled' })
	await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	expect(f.actor.getSnapshot().output).toEqual({ kind: 'settled' })
})

it('thrown close posting leaves both receipt observers alive without a retry', async () => {
	const f = fixture(5, true)
	f.actor.start()
	await flush()
	expect(f.onOverdue).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().output).toBeUndefined()
	f.clock.increment(100)
	f.native.resolve({ kind: 'uncertain' })
	await flush()
	f.host.resolve(f.identity)
	await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	expect(f.requestClose).toHaveBeenCalledOnce()
})

it.each([0, -1, NaN, Infinity, 2_147_483_648])(
	'invalid deadline %s reports overdue without discarding proof observation',
	async (deadline) => {
		const f = fixture(deadline)
		f.actor.start()
		expect(f.onOverdue).toHaveBeenCalledOnce()
		expect(f.requestClose).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().output).toBeUndefined()
		f.host.resolve(f.identity)
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
		expect(f.actor.getSnapshot().output).toEqual({ kind: 'host-closed', receipt: f.identity })
	}
)

it.each(['native-first', 'host-first'] as const)(
	'keeps the first proof in a late-proof race: %s',
	async (order) => {
		const f = fixture()
		f.actor.start()
		f.clock.increment(5)
		if (order === 'native-first') f.native.resolve({ kind: 'settled' })
		else f.host.resolve(f.identity)
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
		const final = f.actor.getSnapshot()
		f.native.resolve({ kind: 'settled' })
		f.host.resolve(f.identity)
		await flush()
		f.clock.increment(100)
		expect(f.actor.getSnapshot()).toBe(final)
		expect(final.output?.kind).toBe(order === 'native-first' ? 'settled' : 'host-closed')
	}
)

it('forced stop issues no proof and permits a new custody owner to observe the same receipts', async () => {
	const f = fixture()
	f.actor.start()
	f.actor.stop()
	expect(f.actor.getSnapshot().output).toBeUndefined()
	const replacement = createActor(createWorkerEffectDrain(), { input: f.input, clock: f.clock })
	running.add(replacement)
	replacement.start()
	f.host.resolve(f.identity)
	await waitFor(replacement, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	expect(f.actor.getSnapshot().output).toBeUndefined()
	expect(replacement.getSnapshot().output).toEqual({ kind: 'host-closed', receipt: f.identity })
})

// Receipt ledger oracle. Promises settle once, and only native quiescence or a
// matching scoped receipt can authorize drain. There is no retry or release API.
type Ledger = { native: string; host: string; proof: string; elapsed: number }
const contract = setup({
	schemas: {
		context: types<{ ledger: Ledger }>(),
		events: {
			NATIVE: types<{ kind: 'settled' | 'uncertain' | 'rejected' }>(),
			HOST: types<{ kind: 'valid' | 'stale' | 'rejected' }>(),
			ELAPSE: types<{ ms: number }>()
		}
	}
}).createMachine({
	context: { ledger: { native: '', host: '', proof: '', elapsed: 0 } },
	initial: 'observing',
	states: {
		observing: {
			on: {
				NATIVE: ({ context, event }) => {
					const r = context.ledger
					return r.proof || r.native
						? undefined
						: {
								context: {
									ledger: {
										...r,
										native: event.kind,
										proof: event.kind === 'settled' ? 'settled' : ''
									}
								}
							}
				},
				HOST: ({ context, event }) => {
					const r = context.ledger
					return r.proof || r.host
						? undefined
						: {
								context: {
									ledger: {
										...r,
										host: event.kind,
										proof: event.kind === 'valid' ? 'host-closed' : ''
									}
								}
							}
				},
				ELAPSE: ({ context, event }) =>
					context.ledger.proof
						? undefined
						: {
								context: {
									ledger: { ...context.ledger, elapsed: context.ledger.elapsed + event.ms }
								}
							}
			}
		}
	}
})
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create() {
		const f = fixture()
		f.actor.start()
		return {
			async send(event) {
				if (event.type === 'ELAPSE') f.clock.increment(event.ms)
				else if (event.type === 'NATIVE') {
					if (event.kind === 'rejected') f.native.reject(new Error('generated native uncertainty'))
					else f.native.resolve({ kind: event.kind })
				} else if (event.kind === 'rejected') f.host.reject(new Error('generated observer failure'))
				else f.host.resolve(event.kind === 'valid' ? f.identity : { ...f.identity, scope: 'A-1' })
				await flush()
			},
			read: () => ({
				proof: f.actor.getSnapshot().output?.kind ?? '',
				closePosts: f.requestClose.mock.calls.length
			}),
			dispose() {
				f.actor.stop()
				running.delete(f.actor)
			}
		}
	},
	projectModel: ({ context }) => ({ proof: context.ledger.proof, closePosts: 1 })
}
it('matches generated late native evidence, stale receipts, deadline and proof-order sequences', async () => {
	const { coverage } = await propertyTest(contract, {
		events: {
			NATIVE: fc.record({ kind: fc.constantFrom('settled', 'uncertain', 'rejected') }),
			HOST: fc.record({ kind: fc.constantFrom('valid', 'stale', 'rejected') }),
			ELAPSE: fc.record({ ms: fc.integer({ min: 0, max: 9 }) })
		},
		sut,
		seed: 20261114,
		numRuns: 300,
		maxCommands: 16,
		failures: { key: 'worker-effect-drain' }
	})
	assertTestCoverage(coverage, { eventTypes: 1, stateNodes: 1, transitions: 1 })
})
