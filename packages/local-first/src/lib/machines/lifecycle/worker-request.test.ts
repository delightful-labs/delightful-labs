import { createActor, setup, SimulatedClock, types, waitFor } from 'xstate'
import type { EventFrom, SnapshotFrom } from 'xstate'
import { afterEach, expect, it, vi } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import type {
	WorkerPostReceipt,
	WorkerRequestIdentity,
	WorkerRequestInput,
	WorkerRequestResult
} from '../../contracts/worker-request.js'
import { createWorkerRequest } from './worker-request.js'

type Request = { value: string }
type Response = { receipt: string } | undefined
const identity: WorkerRequestIdentity = { scope: 'A-3', requestId: 'same-id', sequence: 7 }
const running = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of running) actor.stop()
	running.clear()
})
function fixture(options: Partial<WorkerRequestInput<Request>> = {}) {
	const clock = new SimulatedClock()
	const post = vi.fn<WorkerRequestInput<Request>['post']>(() => ({ kind: 'posted' }))
	const input: WorkerRequestInput<Request> = {
		identity,
		request: { value: 'private payload' },
		effect: 'effect',
		post,
		...options
	}
	const actor = createActor(createWorkerRequest<Request, Response>(), { input, clock })
	running.add(actor)
	return { actor, clock, post, input }
}
async function awaitingReply(f: ReturnType<typeof fixture>) {
	await waitFor(f.actor, (snapshot) => snapshot.matches({ pending: 'awaitingReply' }), {
		timeout: 1000
	})
}

it.each([{ receipt: 'exact object' }, undefined])(
	'posts once and returns the original identity and exact response %j',
	async (response) => {
		const f = fixture()
		const initial = f.actor.getSnapshot()
		const event = { type: 'REPLY', reply: { kind: 'succeeded', identity, response } } as const
		for (let attempt = 0; attempt < 3; attempt++) expect(initial.can(event)).toBe(true)
		expect(f.post).not.toHaveBeenCalled()
		f.actor.start()
		await awaitingReply(f)
		const before = f.actor.getSnapshot()
		expect(before.can(event)).toBe(true)
		expect(f.actor.getSnapshot()).toBe(before)
		f.actor.send(event)
		const final = f.actor.getSnapshot()
		expect(final.status).toBe('done')
		expect(final.output).toEqual({ kind: 'succeeded', identity, response })
		expect(final.output?.identity).toBe(identity)
		if (final.output?.kind === 'succeeded') expect(final.output.response).toBe(response)
		expect(final.context.record.call).toBeUndefined()
		expect(before.context.record.call).toBe(f.input)
		expect(before.context.record.result).toBeUndefined()
		expect(f.post).toHaveBeenCalledExactlyOnceWith(f.input.request, identity)
		f.actor.send({ type: 'TRANSPORT_FAILED', scope: identity.scope, reason: 'closed' })
		f.actor.send(event)
		f.clock.increment(20_000)
		expect(f.actor.getSnapshot()).toBe(final)
		expect(f.post).toHaveBeenCalledOnce()
	}
)

it('accepts a reply synchronously delivered during native posting', () => {
	const response = { receipt: 'early' }
	const f = fixture({
		post: () => {
			f.actor.send({ type: 'REPLY', reply: { kind: 'succeeded', identity, response } })
			return { kind: 'posted' }
		}
	})
	f.actor.start()
	expect(f.actor.getSnapshot().output).toEqual({ kind: 'succeeded', identity, response })
})

it('a matching reply wins over a later thrown post completion', async () => {
	const response = { receipt: 'accepted before throw' }
	const f = fixture({
		post: () => {
			f.actor.send({ type: 'REPLY', reply: { kind: 'succeeded', identity, response } })
			throw new Error('failure after reply')
		}
	})
	f.actor.start()
	await Promise.resolve()
	await Promise.resolve()
	expect(f.actor.getSnapshot().output).toEqual({ kind: 'succeeded', identity, response })
})

it('stopping before startup prevents any native call', () => {
	const f = fixture()
	f.actor.stop()
	expect(() => f.actor.start()).toThrow(/cannot be restarted/)
	expect(f.post).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().output).toBeUndefined()
})

it('accepts the maximum safe native timer delay without overflowing it', async () => {
	const f = fixture({ timeoutMs: 2_147_483_647 })
	f.actor.start()
	await awaitingReply(f)
	f.clock.increment(2_147_483_646)
	expect(f.actor.getSnapshot().status).toBe('active')
	f.clock.increment(1)
	expect(f.actor.getSnapshot().output).toEqual({
		kind: 'failed',
		identity,
		reason: 'timeout',
		effectOutcome: 'unknown'
	})
})

it('query failure reports never imply a mutation even if peer evidence is unknown', async () => {
	const f = fixture({ effect: 'query' })
	f.actor.start()
	await awaitingReply(f)
	f.actor.send({
		type: 'REPLY',
		reply: {
			identity,
			kind: 'failed',
			reason: 'invalid-reply',
			effectOutcome: 'unknown'
		}
	})
	expect(f.actor.getSnapshot().output).toEqual({
		kind: 'failed',
		identity,
		reason: 'invalid-reply',
		effectOutcome: 'not-issued'
	})
})

it.each([
	{ ...identity, scope: 'A-1' },
	{ ...identity, requestId: 'other' },
	{ ...identity, sequence: 6 }
])('ignores stale success and failure replies for %j', async (stale) => {
	const f = fixture()
	f.actor.start()
	await awaitingReply(f)
	f.actor.send({
		type: 'REPLY',
		reply: { identity: stale, kind: 'succeeded', response: { receipt: 'stale' } }
	})
	f.actor.send({
		type: 'REPLY',
		reply: { identity: stale, kind: 'failed', reason: 'rejected', effectOutcome: 'not-issued' }
	})
	f.actor.send({ type: 'TRANSPORT_FAILED', scope: 'A-1', reason: 'closed' })
	expect(f.actor.getSnapshot().status).toBe('active')
	f.actor.send({ type: 'REPLY', reply: { identity, kind: 'succeeded', response: undefined } })
	expect(f.actor.getSnapshot().status).toBe('done')
})

it.each([0, -1, 0.5, NaN, Infinity, 2_147_483_648])(
	'rejects invalid deadline %s without invoking native posting',
	(timeoutMs) => {
		const f = fixture({ timeoutMs })
		f.actor.start()
		expect(f.post).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().output).toEqual({
			kind: 'failed',
			identity,
			reason: 'rejected',
			effectOutcome: 'not-issued'
		})
		expect(f.actor.getSnapshot().context.record.call).toBeUndefined()
	}
)

it.each(['query', 'effect'] as const)(
	'expires the default deadline for a posted %s',
	async (effect) => {
		const f = fixture({ effect })
		f.actor.start()
		await awaitingReply(f)
		f.clock.increment(9999)
		expect(f.actor.getSnapshot().status).toBe('active')
		f.clock.increment(1)
		expect(f.actor.getSnapshot().output).toEqual({
			kind: 'failed',
			identity,
			reason: 'timeout',
			effectOutcome: effect === 'query' ? 'not-issued' : 'unknown'
		})
		expect(f.post).toHaveBeenCalledOnce()
	}
)

it('the enclosing deadline also covers posting before its receipt settles', async () => {
	const f = fixture({ timeoutMs: 10 })
	f.actor.start()
	expect(f.actor.getSnapshot().matches({ pending: 'posting' })).toBe(true)
	f.clock.increment(10)
	await Promise.resolve()
	await Promise.resolve()
	expect(f.actor.getSnapshot().output).toEqual({
		kind: 'failed',
		identity,
		reason: 'timeout',
		effectOutcome: 'unknown'
	})
	expect(f.post).toHaveBeenCalledOnce()
})

it.each(['rejected', 'unavailable'] as const)(
	'preserves a native not-issued %s receipt',
	async (reason) => {
		const f = fixture({ post: () => ({ kind: 'not-issued', reason }) })
		f.actor.start()
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
		expect(f.actor.getSnapshot().output).toEqual({
			kind: 'failed',
			identity,
			reason,
			effectOutcome: 'not-issued'
		})
	}
)

it.each(['query', 'effect'] as const)(
	'keeps unexpected post failure conservative for a %s',
	async (effect) => {
		const post = vi.fn<() => WorkerPostReceipt>(() => {
			throw new Error('native failure')
		})
		const f = fixture({ effect, post })
		f.actor.start()
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
		expect(f.actor.getSnapshot().output).toEqual({
			kind: 'failed',
			identity,
			reason: 'unavailable',
			effectOutcome: effect === 'query' ? 'not-issued' : 'unknown'
		})
		expect(post).toHaveBeenCalledOnce()
	}
)

it.each(['rejected', 'unavailable', 'invalid-reply'] as const)(
	'preserves explicit peer %s evidence',
	async (reason) => {
		for (const effectOutcome of ['not-issued', 'unknown'] as const) {
			const f = fixture()
			f.actor.start()
			await awaitingReply(f)
			f.actor.send({ type: 'REPLY', reply: { identity, kind: 'failed', reason, effectOutcome } })
			expect(f.actor.getSnapshot().output).toEqual({
				kind: 'failed',
				identity,
				reason,
				effectOutcome
			})
		}
	}
)

it.each(['closed', 'unavailable', 'invalid-reply'] as const)(
	'reports scoped transport %s without claiming effect cancellation',
	async (reason) => {
		const f = fixture()
		f.actor.start()
		await awaitingReply(f)
		f.actor.send({ type: 'TRANSPORT_FAILED', scope: identity.scope, reason })
		expect(f.actor.getSnapshot().output).toEqual({
			kind: 'failed',
			identity,
			reason,
			effectOutcome: 'unknown'
		})
		expect(f.actor.getSnapshot().context.record.call).toBeUndefined()
	}
)

it.each(['reply-first', 'deadline-first'] as const)('settles a deadline race once: %s', (order) => {
	const f = fixture({ timeoutMs: 1 })
	f.actor.start()
	const reply = () =>
		f.actor.send({ type: 'REPLY', reply: { identity, kind: 'succeeded', response: undefined } })
	if (order === 'reply-first') reply()
	f.clock.increment(1)
	if (order === 'deadline-first') reply()
	expect(f.actor.getSnapshot().output?.kind).toBe(order === 'reply-first' ? 'succeeded' : 'failed')
	expect(f.post).toHaveBeenCalledOnce()
})

it('forced stop publishes no settlement or rollback receipt and cannot issue again', async () => {
	const f = fixture()
	f.actor.start()
	f.actor.stop()
	await Promise.resolve()
	f.clock.increment(20_000)
	expect(f.actor.getSnapshot().status).toBe('stopped')
	expect(f.actor.getSnapshot().output).toBeUndefined()
	expect(f.post).toHaveBeenCalledOnce()
	expect(() => f.actor.start()).toThrow(/cannot be restarted/)
})

// External ledger oracle: first admissible settlement wins; elapsed time is a
// test input. This has no posting child, pending hierarchy or native timer.
type Match = 'exact' | 'scope' | 'requestId' | 'sequence'
type Observed = { outcome: string; posts: number }
const contract = setup({
	schemas: {
		context: types<{ elapsed: number; outcome: string }>(),
		events: {
			OK: types<{ match: Match }>(),
			REJECT: types<{ match: Match; evidence: 'not-issued' | 'unknown' }>(),
			LOST: types<{ currentScope: boolean }>(),
			ELAPSE: types<{ ms: number }>()
		}
	}
}).createMachine({
	context: { elapsed: 0, outcome: 'pending' },
	initial: 'open',
	states: {
		open: {
			on: {
				OK: ({ event }) =>
					event.match === 'exact'
						? { target: 'settled', context: { outcome: 'succeeded' } }
						: undefined,
				REJECT: ({ event }) =>
					event.match === 'exact'
						? { target: 'settled', context: { outcome: `rejected:${event.evidence}` } }
						: undefined,
				LOST: ({ event }) =>
					event.currentScope
						? { target: 'settled', context: { outcome: 'closed:unknown' } }
						: undefined,
				ELAPSE: ({ context, event }) => {
					const elapsed = context.elapsed + event.ms
					return elapsed >= 10
						? { target: 'settled', context: { elapsed, outcome: 'timeout:unknown' } }
						: { context: { elapsed } }
				}
			}
		},
		settled: { on: { OK: {}, REJECT: {}, LOST: {}, ELAPSE: {} } }
	}
})
function correlation(match: Match): WorkerRequestIdentity {
	if (match === 'scope') return { ...identity, scope: 'A-1' }
	if (match === 'requestId') return { ...identity, requestId: 'other' }
	if (match === 'sequence') return { ...identity, sequence: 6 }
	return identity
}
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	async create() {
		const f = fixture({ timeoutMs: 10 })
		f.actor.start()
		await awaitingReply(f)
		return {
			send(event) {
				if (event.type === 'ELAPSE') f.clock.increment(event.ms)
				else if (event.type === 'LOST')
					f.actor.send({
						type: 'TRANSPORT_FAILED',
						scope: event.currentScope ? identity.scope : 'old',
						reason: 'closed'
					})
				else if (event.type === 'OK')
					f.actor.send({
						type: 'REPLY',
						reply: { identity: correlation(event.match), kind: 'succeeded', response: undefined }
					})
				else
					f.actor.send({
						type: 'REPLY',
						reply: {
							identity: correlation(event.match),
							kind: 'failed',
							reason: 'rejected',
							effectOutcome: event.evidence
						}
					})
			},
			read(): Observed {
				const result: WorkerRequestResult<Response> | undefined = f.actor.getSnapshot().output
				const outcome = !result
					? 'pending'
					: result.kind === 'succeeded'
						? 'succeeded'
						: `${result.reason}:${result.effectOutcome}`
				return { outcome, posts: f.post.mock.calls.length }
			},
			dispose() {
				f.actor.stop()
				running.delete(f.actor)
			}
		}
	},
	projectModel: (snapshot): Observed => ({ outcome: snapshot.context.outcome, posts: 1 })
}
it('matches generated correlation, timeout, transport and duplicate settlement sequences', async () => {
	const match = fc.constantFrom<Match>('exact', 'scope', 'requestId', 'sequence')
	const { coverage } = await propertyTest(contract, {
		events: {
			OK: fc.record({ match }),
			REJECT: fc.record({ match, evidence: fc.constantFrom('not-issued', 'unknown') }),
			LOST: fc.record({ currentScope: fc.boolean() }),
			ELAPSE: fc.record({ ms: fc.integer({ min: 0, max: 12 }) })
		},
		sut,
		seed: 20261112,
		numRuns: 300,
		maxCommands: 16,
		failures: { key: 'worker-request-lifecycle' }
	})
	assertTestCoverage(coverage, { eventTypes: 1, stateNodes: 1, transitions: 1 })
})
