import { createActor, SimulatedClock, setup, types } from 'xstate'
import type { EventFrom, SnapshotFrom } from 'xstate'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { afterEach, expect, it, vi } from 'vitest'
import type {
	WorkerChannelCall,
	WorkerChannelControl,
	WorkerChannelData,
	WorkerChannelInput,
	WorkerChannelResult
} from '../../contracts/worker-channel.js'
import type { WorkerRequestIdentity } from '../../contracts/worker-request.js'
import { createWorkerChannel } from './worker-channel.js'

type Request = { expected: 'data' | 'port'; name: string }
type Response = { kind: 'data' | 'port'; id: string; dispose: () => void }
const running = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of running) actor.stop()
	running.clear()
})
function response(id = 'response', kind: Response['kind'] = 'port'): Response {
	return { kind, id, dispose: vi.fn() }
}
function fixture(overrides: Partial<WorkerChannelInput<Request, Response>> = {}) {
	let data!: (event: WorkerChannelData<Response>) => void
	let control!: (event: WorkerChannelControl) => void
	const clock = new SimulatedClock()
	const posted: { request: Request; identity: WorkerRequestIdentity }[] = []
	const dataDisposed = vi.fn(),
		controlDisposed = vi.fn()
	const configuration: WorkerChannelInput<Request, Response> = {
		scope: 'A-3',
		closeRequestId: 'close-A-3',
		maxInFlight: 8,
		requestTimeoutMs: 5,
		closeTimeoutMs: 10,
		post: vi.fn<WorkerChannelInput<Request, Response>['post']>((request, identity) => {
			posted.push({ request, identity })
			return { kind: 'posted' }
		}),
		listenData: (report) => {
			data = report
			return dataDisposed
		},
		listenControl: (report) => {
			control = report
			return controlDisposed
		},
		postClose: vi.fn(),
		discard: vi.fn((resource) => resource.dispose()),
		onOverdue: vi.fn(),
		onBlocked: vi.fn(),
		...overrides
	}
	const actor = createActor(createWorkerChannel<Request, Response>(), {
		input: configuration,
		clock
	})
	running.add(actor)
	function begin(
		name: string,
		effect: 'effect' | 'query' = 'effect',
		expected: Response['kind'] = 'port'
	) {
		const settle = vi.fn<(result: WorkerChannelResult<Response>) => void>()
		const call: WorkerChannelCall<Request, Response> = {
			requestId: name,
			request: { name, expected },
			effect,
			accept: (value) => value.kind === expected,
			settle
		}
		actor.send({ type: 'REQUEST', call })
		return { call, settle }
	}
	return {
		actor,
		clock,
		posted,
		configuration,
		dataDisposed,
		controlDisposed,
		begin,
		data: (event: WorkerChannelData<Response>) => data(event),
		control: (event: WorkerChannelControl) => control(event),
		reply: (index: number, value = response()) =>
			data({
				type: 'REPLY',
				reply: { kind: 'succeeded', identity: posted[index]!.identity, response: value }
			}),
		ack: () =>
			control({
				type: 'HOST_CLOSED',
				receipt: { scope: configuration.scope, requestId: configuration.closeRequestId }
			})
	}
}

it('admits eight concurrent calls, refuses excess, and routes out-of-order replies once', () => {
	const f = fixture()
	f.actor.start()
	const calls = Array.from({ length: 9 }, (_, index) => f.begin(`request-${index}`))
	expect(f.posted).toHaveLength(8)
	expect(f.posted.map((call) => call.identity.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
	expect(calls[8]!.settle).toHaveBeenCalledExactlyOnceWith({
		kind: 'refused',
		scope: 'A-3',
		requestId: 'request-8',
		reason: 'overloaded',
		effectOutcome: 'not-issued'
	})
	for (const index of [7, 2, 4, 0, 6, 1, 5, 3]) {
		const value = response(String(index))
		f.reply(index, value)
		expect(calls[index]!.settle).toHaveBeenCalledExactlyOnceWith({
			kind: 'succeeded',
			identity: f.posted[index]!.identity,
			response: value
		})
		expect(value.dispose).not.toHaveBeenCalled()
	}
	expect(f.begin('new-capacity').settle).not.toHaveBeenCalled()
	expect(f.posted).toHaveLength(9)
	f.actor.send({ type: 'CLOSE' })
	f.ack()
	expect(f.actor.getSnapshot().status).toBe('done')
	expect(f.dataDisposed).toHaveBeenCalledOnce()
	expect(f.controlDisposed).toHaveBeenCalledOnce()
})

it('rejects duplicate active IDs, then permits reuse only with a fresh sequence', () => {
	const f = fixture()
	f.actor.start()
	const first = f.begin('same'),
		duplicate = f.begin('same')
	expect(f.posted).toHaveLength(1)
	expect(duplicate.settle.mock.calls[0]?.[0]).toMatchObject({ kind: 'refused', reason: 'rejected' })
	f.reply(0)
	const second = f.begin('same'),
		stale = response('stale')
	f.reply(0, stale)
	expect(stale.dispose).toHaveBeenCalledOnce()
	expect(second.settle).not.toHaveBeenCalled()
	f.reply(1)
	expect(first.settle).toHaveBeenCalledOnce()
	expect(second.settle).toHaveBeenCalledOnce()
	expect(f.posted[1]!.identity.sequence).toBe(2)
})

it.each(['scope', 'requestId', 'sequence'] as const)(
	'discards unknown %s success without settling a live call',
	(field) => {
		const f = fixture()
		f.actor.start()
		const call = f.begin('current')
		const stale = { ...f.posted[0]!.identity, [field]: field === 'sequence' ? 0 : 'old' }
		const resource = response('orphan')
		f.data({ type: 'REPLY', reply: { identity: stale, kind: 'succeeded', response: resource } })
		expect(resource.dispose).toHaveBeenCalledOnce()
		expect(call.settle).not.toHaveBeenCalled()
		f.reply(0)
		expect(call.settle).toHaveBeenCalledOnce()
	}
)

it('registers correlation and observer custody before a synchronous native reply', () => {
	const resource = response('early')
	const f = fixture({
		post: (_, identity) => {
			f.data({ type: 'REPLY', reply: { identity, kind: 'succeeded', response: resource } })
			return { kind: 'posted' }
		}
	})
	f.actor.start()
	const call = f.begin('early')
	expect(call.settle.mock.calls[0]?.[0]).toMatchObject({ kind: 'succeeded', response: resource })
	expect(resource.dispose).not.toHaveBeenCalled()
})

it('discards duplicate ports and wrong response kinds, and closes a bad protocol', () => {
	const f = fixture()
	f.actor.start()
	const first = f.begin('first')
	f.reply(0)
	const duplicate = response('duplicate')
	f.reply(0, duplicate)
	expect(duplicate.dispose).toHaveBeenCalledOnce()
	expect(first.settle).toHaveBeenCalledOnce()
	const second = f.begin('read', 'query', 'data'),
		wrong = response('wrong-kind')
	f.reply(1, wrong)
	expect(wrong.dispose).toHaveBeenCalledOnce()
	expect(second.settle.mock.calls[0]?.[0]).toMatchObject({
		kind: 'failed',
		reason: 'invalid-reply',
		effectOutcome: 'not-issued'
	})
	expect(f.configuration.postClose).toHaveBeenCalledOnce()
})

it('a peer rejection with not-issued evidence does not close healthy admission', () => {
	const f = fixture()
	f.actor.start()
	const first = f.begin('rejected')
	f.data({
		type: 'REPLY',
		reply: {
			identity: f.posted[0]!.identity,
			kind: 'failed',
			reason: 'rejected',
			effectOutcome: 'not-issued'
		}
	})
	expect(first.settle.mock.calls[0]?.[0]).toMatchObject({
		kind: 'failed',
		reason: 'rejected',
		effectOutcome: 'not-issued'
	})
	f.begin('next')
	expect(f.posted).toHaveLength(2)
	expect(f.configuration.postClose).not.toHaveBeenCalled()
})

it('a request deadline settles all observers once, closes admission and retains late control receipt handling', () => {
	const f = fixture()
	f.actor.start()
	const effect = f.begin('write'),
		query = f.begin('read', 'query')
	f.clock.increment(5)
	expect(effect.settle.mock.calls[0]?.[0]).toMatchObject({
		kind: 'failed',
		reason: 'timeout',
		effectOutcome: 'unknown'
	})
	expect(query.settle.mock.calls[0]?.[0]).toMatchObject({
		kind: 'failed',
		effectOutcome: 'not-issued'
	})
	expect(f.configuration.postClose).toHaveBeenCalledExactlyOnceWith({
		scope: 'A-3',
		requestId: 'close-A-3'
	})
	const refused = f.begin('after-close')
	expect(refused.settle.mock.calls[0]?.[0]).toMatchObject({
		kind: 'refused',
		reason: 'closed',
		effectOutcome: 'not-issued'
	})
	f.clock.increment(10)
	expect(f.configuration.onOverdue).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().output).toBeUndefined()
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.controlDisposed).not.toHaveBeenCalled()
	const late = response('late')
	f.reply(0, late)
	expect(late.dispose).toHaveBeenCalledOnce()
	f.control({ type: 'HOST_CLOSED', receipt: { scope: 'A-1', requestId: 'close-A-3' } })
	f.control({ type: 'HOST_CLOSED', receipt: { scope: 'A-3', requestId: 'wrong-close' } })
	expect(f.actor.getSnapshot().output).toBeUndefined()
	f.ack()
	expect(f.actor.getSnapshot().output).toEqual({ scope: 'A-3', requestId: 'close-A-3' })
	expect(effect.settle).toHaveBeenCalledOnce()
	expect(query.settle).toHaveBeenCalledOnce()
	expect(f.posted).toHaveLength(2)
	expect(f.controlDisposed).toHaveBeenCalledOnce()
})

it.each(['closed', 'unavailable', 'invalid-reply'] as const)(
	'closes all calls on a scoped %s failure',
	(reason) => {
		const f = fixture()
		f.actor.start()
		const call = f.begin('write')
		f.data({ type: 'TRANSPORT_FAILED', scope: 'A-1', reason })
		expect(call.settle).not.toHaveBeenCalled()
		f.data({ type: 'TRANSPORT_FAILED', scope: 'A-3', reason })
		expect(call.settle.mock.calls[0]?.[0]).toMatchObject({
			kind: 'failed',
			effectOutcome: 'unknown'
		})
		f.actor.send({ type: 'CLOSE' })
		f.actor.send({ type: 'CLOSE' })
		expect(f.configuration.postClose).toHaveBeenCalledOnce()
		f.ack()
		expect(f.actor.getSnapshot().status).toBe('done')
	}
)

it.each(['throw', 'not-issued'] as const)('does not replay failed posting: %s', async (mode) => {
	const post = vi.fn<WorkerChannelInput<Request, Response>['post']>(() => {
		if (mode === 'throw') throw new Error('native failure')
		return { kind: 'not-issued', reason: 'unavailable' }
	})
	const f = fixture({ post })
	f.actor.start()
	const call = f.begin('write')
	await vi.waitFor(() => expect(call.settle).toHaveBeenCalledOnce(), { timeout: 1000 })
	expect(call.settle.mock.calls[0]?.[0]).toMatchObject({
		kind: 'failed',
		reason: 'unavailable',
		effectOutcome: mode === 'throw' ? 'unknown' : 'not-issued'
	})
	expect(post).toHaveBeenCalledOnce()
	expect(f.configuration.postClose).toHaveBeenCalledOnce()
})

it('keeps late receipts after control failure or thrown close posting, without reposting', async () => {
	const f = fixture({
		postClose: vi.fn(() => {
			throw new Error('control post failed')
		})
	})
	f.actor.start()
	f.actor.send({ type: 'CLOSE' })
	await vi.waitFor(() => expect(f.configuration.onOverdue).toHaveBeenCalledOnce(), {
		timeout: 1000
	})
	f.control({ type: 'CLOSE_FAILED', scope: 'A-3' })
	f.actor.send({ type: 'CLOSE' })
	f.clock.increment(100)
	expect(f.configuration.postClose).toHaveBeenCalledOnce()
	expect(f.configuration.onOverdue).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().output).toBeUndefined()
	expect(f.controlDisposed).not.toHaveBeenCalled()
	f.ack()
	expect(f.actor.getSnapshot().status).toBe('done')
})

it('control listener registration precedes a close receipt delivered during posting', () => {
	const f = fixture({ postClose: () => f.ack() })
	f.actor.start()
	f.actor.send({ type: 'CLOSE' })
	expect(f.actor.getSnapshot().status).toBe('done')
})

it('listener setup failure closes conservatively and still observes real closure', () => {
	const f = fixture({
		listenData: () => {
			throw new Error('cannot listen')
		}
	})
	f.actor.start()
	expect(f.configuration.postClose).toHaveBeenCalledOnce()
	f.ack()
	expect(f.actor.getSnapshot().status).toBe('done')
})

it.each([0, 9, 1.5])(
	'blocks invalid capacity %s before creating native listeners',
	(maxInFlight) => {
		const f = fixture({ maxInFlight })
		f.actor.start()
		expect(f.configuration.onBlocked).toHaveBeenCalledOnce()
		expect(f.posted).toHaveLength(0)
		expect(f.begin('rejected').settle.mock.calls[0]?.[0]).toMatchObject({
			kind: 'refused',
			effectOutcome: 'not-issued'
		})
		expect(f.configuration.postClose).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().output).toBeUndefined()
	}
)

it('can() does not post or register new native work and prior snapshots remain immutable', () => {
	const f = fixture()
	f.actor.start()
	const before = f.actor.getSnapshot(),
		call: WorkerChannelCall<Request, Response> = {
			requestId: 'pure',
			request: { name: 'pure', expected: 'port' },
			effect: 'effect',
			accept: () => true,
			settle: vi.fn()
		}
	for (let index = 0; index < 3; index++) expect(before.can({ type: 'REQUEST', call })).toBe(true)
	expect(f.posted).toHaveLength(0)
	expect(f.actor.getSnapshot()).toBe(before)
	f.actor.send({ type: 'REQUEST', call })
	expect(f.posted).toHaveLength(1)
	expect(before.context.record.receipt).toBeUndefined()
})

it('observer exceptions discard an unaccepted response and do not poison another request', () => {
	const f = fixture()
	f.actor.start()
	const settle = vi.fn(() => {
		throw new Error('observer failed')
	})
	f.actor.send({
		type: 'REQUEST',
		call: {
			requestId: 'bad-observer',
			request: { name: 'bad', expected: 'port' },
			effect: 'effect',
			accept: () => true,
			settle
		}
	})
	const resource = response()
	f.reply(0, resource)
	expect(resource.dispose).toHaveBeenCalledOnce()
	expect(settle).toHaveBeenCalledOnce()
	const next = f.begin('next')
	f.reply(1)
	expect(next.settle).toHaveBeenCalledOnce()
	expect(f.configuration.postClose).not.toHaveBeenCalled()
})

it('unexpected response predicate failure releases resources, fails observers and reports blocked', () => {
	const f = fixture()
	f.actor.start()
	const settle = vi.fn()
	f.actor.send({
		type: 'REQUEST',
		call: {
			requestId: 'predicate-error',
			request: { name: 'bad', expected: 'port' },
			effect: 'effect',
			accept: () => {
				throw new Error('predicate failure')
			},
			settle
		}
	})
	const resource = response()
	f.reply(0, resource)
	expect(resource.dispose).toHaveBeenCalledOnce()
	expect(settle).toHaveBeenCalledOnce()
	expect(settle.mock.calls[0]?.[0]).toMatchObject({ kind: 'failed', effectOutcome: 'unknown' })
	expect(f.configuration.onBlocked).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().output).toBeUndefined()
	expect(f.begin('after-crash').settle.mock.calls[0]?.[0]).toMatchObject({
		kind: 'refused',
		reason: 'unavailable'
	})
})

it('an unsolicited close receipt cannot stop an accepting channel', () => {
	const f = fixture()
	f.actor.start()
	f.ack()
	expect(f.actor.getSnapshot().status).toBe('active')
	const call = f.begin('still-accepting')
	f.reply(0)
	expect(call.settle).toHaveBeenCalledOnce()
	expect(f.configuration.postClose).not.toHaveBeenCalled()
})

it('an observer stopping the parent after accepting custody keeps its response resource', () => {
	const f = fixture()
	f.actor.start()
	f.actor.send({
		type: 'REQUEST',
		call: {
			requestId: 'stop',
			request: { name: 'stop', expected: 'port' },
			effect: 'effect',
			accept: () => true,
			settle: () => f.actor.stop()
		}
	})
	const resource = response()
	f.reply(0, resource)
	expect(resource.dispose).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().output).toBeUndefined()
})

it('forced stop settles native observers conservatively and never manufactures host closure', () => {
	const f = fixture()
	f.actor.start()
	const effect = f.begin('effect'),
		query = f.begin('query', 'query')
	f.actor.stop()
	f.clock.increment(100)
	expect(effect.settle).toHaveBeenCalledExactlyOnceWith({
		kind: 'failed',
		identity: f.posted[0]!.identity,
		reason: 'closed',
		effectOutcome: 'unknown'
	})
	expect(query.settle).toHaveBeenCalledExactlyOnceWith({
		kind: 'failed',
		identity: f.posted[1]!.identity,
		reason: 'closed',
		effectOutcome: 'not-issued'
	})
	expect(f.actor.getSnapshot().output).toBeUndefined()
	expect(f.dataDisposed).toHaveBeenCalledOnce()
	expect(f.controlDisposed).toHaveBeenCalledOnce()
	const late = response('delivered-after-native-detach')
	f.reply(0, late)
	expect(late.dispose).toHaveBeenCalledOnce()
})

it('forced stop during reply validation discards a port that has not reached an observer', () => {
	const f = fixture()
	f.actor.start()
	const settle = vi.fn()
	f.actor.send({
		type: 'REQUEST',
		call: {
			requestId: 'stop-validation',
			request: { name: 'stop', expected: 'port' },
			effect: 'effect',
			accept: () => {
				f.actor.stop()
				return true
			},
			settle
		}
	})
	const resource = response()
	f.reply(0, resource)
	expect(resource.dispose).toHaveBeenCalledOnce()
	expect(settle).toHaveBeenCalledOnce()
	expect(settle.mock.calls[0]?.[0]).toMatchObject({ kind: 'failed', effectOutcome: 'unknown' })
})

// Independent external ledger: bounded admission, first settlement, native post
// count and resource dispositions. It contains no request actors/subscriptions,
// native listeners, controller states or copies of the implementation's context.
type LedgerCall = { id: string; sequence: number; due: number; effect: 'query' | 'effect' }
type Ledger = {
	now: number
	issued: number
	active: LedgerCall[]
	outcomes: string[]
	discarded: number
	closePosts: number
	acknowledged: boolean
}
function describeResult(result: WorkerChannelResult<Response>) {
	if (result.kind === 'refused') return `${result.requestId}:refused:${result.reason}`
	if (result.kind === 'succeeded')
		return `${result.identity.requestId}:${result.identity.sequence}:ok`
	return `${result.identity.requestId}:${result.identity.sequence}:${result.reason}:${result.effectOutcome}`
}
function closeLedger(record: Ledger, expired?: LedgerCall): Ledger {
	if (record.closePosts) return record
	const ordered = expired
		? [expired, ...record.active.filter((call) => call !== expired)]
		: record.active
	return {
		...record,
		active: [],
		closePosts: 1,
		outcomes: [
			...record.outcomes,
			...ordered.map(
				(call) =>
					`${call.id}:${call.sequence}:${call === expired ? 'timeout' : 'closed'}:${call.effect === 'effect' ? 'unknown' : 'not-issued'}`
			)
		]
	}
}
const contract = setup({
	schemas: {
		context: types<{ ledger: Ledger }>(),
		events: {
			ADMIT: types<{ id: string; effect: 'query' | 'effect' }>(),
			ANSWER: types<{ id: string; current: boolean }>(),
			ELAPSE: types<{ ms: number }>(),
			CLOSE: types(),
			ACK: types<{ valid: boolean }>()
		}
	}
}).createMachine({
	context: {
		ledger: {
			now: 0,
			issued: 0,
			active: [],
			outcomes: [],
			discarded: 0,
			closePosts: 0,
			acknowledged: false
		}
	},
	initial: 'exercising',
	states: {
		exercising: {
			on: {
				ADMIT: ({ context, event }) => {
					const r = context.ledger
					if (r.acknowledged) return
					const refusal = r.closePosts
						? 'closed'
						: r.active.length === 2
							? 'overloaded'
							: r.active.some((call) => call.id === event.id)
								? 'rejected'
								: undefined
					return {
						context: {
							ledger: refusal
								? { ...r, outcomes: [...r.outcomes, `${event.id}:refused:${refusal}`] }
								: {
										...r,
										issued: r.issued + 1,
										active: [
											...r.active,
											{ id: event.id, sequence: r.issued + 1, due: r.now + 5, effect: event.effect }
										]
									}
						}
					}
				},
				ANSWER: ({ context, event }) => {
					const r = context.ledger
					if (r.acknowledged) return
					const call = event.current ? r.active.find((call) => call.id === event.id) : undefined
					return {
						context: {
							ledger: call
								? {
										...r,
										active: r.active.filter((active) => active !== call),
										outcomes: [...r.outcomes, `${call.id}:${call.sequence}:ok`]
									}
								: { ...r, discarded: r.discarded + 1 }
						}
					}
				},
				ELAPSE: ({ context, event }) => {
					const r = { ...context.ledger, now: context.ledger.now + event.ms }
					if (r.acknowledged) return
					return { context: { ledger: closeLedgerIfExpired(r) } }
				},
				CLOSE: ({ context }) =>
					context.ledger.acknowledged
						? undefined
						: { context: { ledger: closeLedger(context.ledger) } },
				ACK: ({ context, event }) =>
					event.valid && context.ledger.closePosts
						? { context: { ledger: { ...context.ledger, acknowledged: true } } }
						: undefined
			}
		}
	}
})
function closeLedgerIfExpired(record: Ledger) {
	return record.active.some((call) => call.due <= record.now)
		? closeLedger(
				record,
				record.active.find((call) => call.due <= record.now)
			)
		: record
}
type Observation = {
	issued: number
	outcomes: string[]
	discarded: number
	closePosts: number
	acknowledged: boolean
}
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create() {
		const f = fixture({ maxInFlight: 2 })
		f.actor.start()
		const outcomes: string[] = []
		return {
			send(event) {
				if (f.actor.getSnapshot().status === 'done') return
				if (event.type === 'ADMIT')
					f.actor.send({
						type: 'REQUEST',
						call: {
							requestId: event.id,
							request: { name: event.id, expected: 'port' },
							effect: event.effect,
							accept: () => true,
							settle: (result) => outcomes.push(describeResult(result))
						}
					})
				else if (event.type === 'ANSWER') {
					const identity = f.posted.findLast((posted) => posted.identity.requestId === event.id)
						?.identity ?? { scope: 'A-3', requestId: event.id, sequence: 0 }
					f.data({
						type: 'REPLY',
						reply: {
							kind: 'succeeded',
							identity: event.current ? identity : { ...identity, scope: 'A-1' },
							response: response()
						}
					})
				} else if (event.type === 'ELAPSE') f.clock.increment(event.ms)
				else if (event.type === 'CLOSE') f.actor.send({ type: 'CLOSE' })
				else
					f.control({
						type: 'HOST_CLOSED',
						receipt: { scope: event.valid ? 'A-3' : 'A-1', requestId: 'close-A-3' }
					})
			},
			read(): Observation {
				return {
					issued: f.posted.length,
					outcomes,
					discarded: vi.mocked(f.configuration.discard).mock.calls.length,
					closePosts: vi.mocked(f.configuration.postClose).mock.calls.length,
					acknowledged: f.actor.getSnapshot().status === 'done'
				}
			},
			dispose() {
				f.actor.stop()
				running.delete(f.actor)
			}
		}
	},
	projectModel: ({ context }): Observation => ({
		issued: context.ledger.issued,
		outcomes: context.ledger.outcomes,
		discarded: context.ledger.discarded,
		closePosts: context.ledger.closePosts,
		acknowledged: context.ledger.acknowledged
	})
}
it('matches generated concurrent admission, replies, deadlines, duplicate close and receipt sequences', async () => {
	const id = fc.constantFrom('a', 'b', 'c', 'd')
	const { coverage } = await propertyTest(contract, {
		events: {
			ADMIT: fc.record({ id, effect: fc.constantFrom('query', 'effect') }),
			ANSWER: fc.record({ id, current: fc.boolean() }),
			ELAPSE: fc.record({ ms: fc.integer({ min: 0, max: 7 }) }),
			CLOSE: fc.constant({}),
			ACK: fc.record({ valid: fc.boolean() })
		},
		sut,
		seed: 20261113,
		numRuns: 400,
		maxCommands: 24,
		failures: { key: 'worker-channel-lifecycle' }
	})
	assertTestCoverage(coverage, { eventTypes: 1, stateNodes: 1, transitions: 1 })
})
