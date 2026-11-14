/// <reference lib="es2024.promise" />
import { afterEach, expect, it, vi } from 'vitest'
import { createActor, waitFor, setup, types } from 'xstate'
import type { EventFrom, SnapshotFrom } from 'xstate'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { indexedDbAccountStoreMachine } from './indexeddb-account-store.js'
import type {
	IndexedDbAccountCall,
	IndexedDbAccountNative,
	IndexedDbAccountNativeEvent,
	IndexedDbAccountResult
} from '../../contracts/indexeddb-account-store.js'

const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(synchronous = false) {
	const closed = Promise.withResolvers<void>()
	let observer: ((event: IndexedDbAccountNativeEvent) => void) | undefined
	const performed: IndexedDbAccountCall[] = []
	const results: { id: number; result: IndexedDbAccountResult }[] = []
	const native = {
		closed: closed.promise,
		listen: (report: (event: IndexedDbAccountNativeEvent) => void) => {
			observer = report
			return () => {
				observer = undefined
				native.close()
			}
		},
		open: vi.fn(),
		close: vi.fn(),
		perform: vi.fn((call: IndexedDbAccountCall) => {
			performed.push(call)
			if (synchronous) observer?.({ type: 'SETTLED', id: call.id, result: { kind: 'updated' } })
		})
	} satisfies IndexedDbAccountNative
	const actor = createActor(indexedDbAccountStoreMachine, { input: { native } })
	actors.add(actor)
	actor.start()
	const report = (event: IndexedDbAccountNativeEvent) => observer?.(event)
	const call = (id: number) =>
		actor.send({
			type: 'CALL',
			call: {
				id,
				operation: { kind: 'update', transform: () => String(id) },
				respond: (result) => results.push({ id, result })
			}
		})
	return { actor, native, performed, results, closed, report, call }
}
const updated: IndexedDbAccountResult = { kind: 'updated' }

it('does not issue storage before native open and serializes calls through native settlement', () => {
	const f = fixture()
	f.call(1)
	f.call(2)
	expect(f.performed).toHaveLength(0)
	f.report({ type: 'OPENED' })
	expect(f.performed.map((call) => call.id)).toEqual([1])
	f.report({ type: 'SETTLED', id: 1, result: updated })
	expect(f.performed.map((call) => call.id)).toEqual([1, 2])
	expect(f.results).toEqual([{ id: 1, result: updated }])
	f.report({ type: 'SETTLED', id: 2, result: updated })
	expect(f.results.map((result) => result.id)).toEqual([1, 2])
})

it.each(['opening', 'running'])('bounds current plus queued work at eight while %s', (phase) => {
	const f = fixture()
	if (phase === 'running') f.report({ type: 'OPENED' })
	for (let id = 1; id <= 9; id++) f.call(id)
	expect(f.results).toEqual([
		{ id: 9, result: { kind: 'failed', reason: 'overloaded', outcome: 'not-issued' } }
	])
	if (phase === 'opening') f.report({ type: 'OPENED' })
	for (let id = 1; id <= 8; id++) f.report({ type: 'SETTLED', id, result: updated })
	expect(f.performed.map((call) => call.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
})

it('registers current ownership before synchronous native completion can reenter', () => {
	const f = fixture(true)
	f.call(1)
	f.call(2)
	f.report({ type: 'OPENED' })
	expect(f.results).toEqual([
		{ id: 1, result: updated },
		{ id: 2, result: updated }
	])
})

it('ignores foreign and duplicated settlements instead of settling a later call', () => {
	const f = fixture()
	f.report({ type: 'OPENED' })
	f.call(1)
	f.call(2)
	f.report({ type: 'SETTLED', id: 30, result: updated })
	expect(f.results).toEqual([])
	f.report({ type: 'SETTLED', id: 1, result: updated })
	f.report({ type: 'SETTLED', id: 1, result: updated })
	expect(f.results).toEqual([{ id: 1, result: updated }])
	f.report({ type: 'SETTLED', id: 2, result: updated })
	expect(f.results.map((result) => result.id)).toEqual([1, 2])
})

it('rejects queued calls on close and retains the issued call until its original receipt', async () => {
	const f = fixture()
	f.report({ type: 'OPENED' })
	f.call(1)
	f.call(2)
	f.actor.send({ type: 'CLOSE' })
	f.call(3)
	expect(f.results).toEqual([
		{ id: 2, result: { kind: 'failed', reason: 'closed', outcome: 'not-issued' } },
		{ id: 3, result: { kind: 'failed', reason: 'closed', outcome: 'not-issued' } }
	])
	expect(f.native.close).not.toHaveBeenCalled()
	f.report({ type: 'SETTLED', id: 1, result: updated })
	expect(f.native.close).toHaveBeenCalled()
	expect(f.actor.getSnapshot().status).toBe('active')
	f.closed.resolve()
	await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	expect(f.performed.map((call) => call.id)).toEqual([1])
})

it('close during open never starts queued work or resumes it after a late grant', async () => {
	const f = fixture()
	f.call(1)
	f.actor.send({ type: 'CLOSE' })
	f.report({ type: 'OPENED' })
	expect(f.performed).toEqual([])
	expect(f.actor.getSnapshot().status).toBe('active')
	f.closed.resolve()
	await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	expect(f.results).toEqual([
		{ id: 1, result: { kind: 'failed', reason: 'closed', outcome: 'not-issued' } }
	])
})

it.each(['OPEN_FAILED', 'INVALIDATED'] satisfies Array<'OPEN_FAILED' | 'INVALIDATED'>)(
	'%s closes admission without inventing an empty account or native release',
	async (type) => {
		const f = fixture()
		f.call(1)
		f.report({ type })
		expect(f.results[0]?.result.kind).toBe('failed')
		expect(f.performed).toEqual([])
		expect(f.actor.getSnapshot().status).toBe('active')
		f.closed.resolve()
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	}
)

it('a native adapter failure settles the caller conservatively and retains native close', async () => {
	const f = fixture()
	f.native.perform.mockImplementationOnce(() => {
		throw new Error('private synthetic failure')
	})
	f.report({ type: 'OPENED' })
	f.call(1)
	expect(f.results).toEqual([
		{ id: 1, result: { kind: 'failed', reason: 'unavailable', outcome: 'unknown' } }
	])
	expect(f.native.close).toHaveBeenCalled()
	expect(f.actor.getSnapshot().status).toBe('active')
	f.closed.resolve()
	await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
})

it('failed native close keeps the owner blocked and refuses further calls', async () => {
	const f = fixture()
	f.actor.send({ type: 'CLOSE' })
	f.closed.reject(new Error('native close unavailable'))
	await waitFor(f.actor, (snapshot) => snapshot.matches('blocked'), { timeout: 1000 })
	f.call(1)
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.results[0]?.result).toEqual({
		kind: 'failed',
		reason: 'closed',
		outcome: 'not-issued'
	})
})

it('forced actor stop detaches observation but cannot manufacture a native close receipt', async () => {
	const f = fixture()
	f.report({ type: 'OPENED' })
	f.call(1)
	let closed = false
	void f.native.closed.then(() => {
		closed = true
	})
	f.actor.stop()
	await Promise.resolve()
	expect(closed).toBe(false)
	expect(f.native.close).toHaveBeenCalled()
	f.closed.resolve()
	await f.native.closed
	expect(closed).toBe(true)
})

// Independent demand ledger: compare native issue order and caller outcomes,
// without using production state values, queue/context or private child refs.
type Ledger = {
	demand: number[]
	issued: number[]
	results: string[]
	next: number
	open: boolean
	closing: boolean
}
function key(id: number, kind: string) {
	return `${id}:${kind}`
}
const contract = setup({
	schemas: {
		context: types<Ledger>(),
		events: { CALL: types(), OPEN: types(), COMPLETE: types<{ stale: boolean }>(), CLOSE: types() }
	}
}).createMachine({
	context: { demand: [], issued: [], results: [], next: 1, open: false, closing: false },
	initial: 'observing',
	states: {
		observing: {
			on: {
				CALL: ({ context: c }) => {
					const id = c.next
					if (c.closing || c.demand.length >= 8)
						return {
							context: {
								next: id + 1,
								results: [...c.results, key(id, 'failed')]
							}
						}
					return {
						context: {
							next: id + 1,
							demand: [...c.demand, id],
							issued: c.open && c.demand.length === 0 ? [...c.issued, id] : c.issued
						}
					}
				},
				OPEN: ({ context: c }) =>
					c.open || c.closing
						? undefined
						: {
								context: {
									open: true,
									issued: c.demand[0] ? [...c.issued, c.demand[0]] : c.issued
								}
							},
				COMPLETE: ({ context: c, event }) => {
					const [id, ...rest] = c.demand
					if (!c.open || !id || event.stale) return
					return {
						context: {
							demand: rest,
							results: [...c.results, key(id, 'updated')],
							issued: !c.closing && rest[0] ? [...c.issued, rest[0]] : c.issued
						}
					}
				},
				CLOSE: ({ context: c }) => {
					if (c.closing) return
					const active = c.open ? c.demand.slice(0, 1) : []
					return {
						context: {
							closing: true,
							demand: active,
							results: [
								...c.results,
								...c.demand.slice(active.length).map((id) => key(id, 'failed'))
							]
						}
					}
				}
			}
		}
	}
})
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create() {
		const f = fixture()
		let next = 1,
			completing = 0
		return {
			send(event) {
				if (event.type === 'CALL') f.call(next++)
				else if (event.type === 'OPEN') f.report({ type: 'OPENED' })
				else if (event.type === 'CLOSE') f.actor.send({ type: 'CLOSE' })
				else {
					const call = f.performed[completing]
					if (call) {
						f.report({ type: 'SETTLED', id: event.stale ? -1 : call.id, result: updated })
						if (!event.stale) completing++
					}
				}
			},
			read: () => ({
				issued: f.performed.map((call) => call.id),
				results: f.results.map(({ id, result }) => key(id, result.kind))
			}),
			dispose() {
				f.actor.stop()
				actors.delete(f.actor)
			}
		}
	},
	projectModel: ({ context }) => ({ issued: context.issued, results: context.results })
}
it('matches bounded generated admission, close, late-open and stale-settlement schedules', async () => {
	const { coverage } = await propertyTest(contract, {
		events: {
			CALL: fc.constant({}),
			OPEN: fc.constant({}),
			CLOSE: fc.constant({}),
			COMPLETE: fc.record({ stale: fc.boolean() })
		},
		sut,
		seed: 20261113,
		numRuns: 300,
		maxCommands: 24,
		failures: { key: 'indexeddb-account-store-owner' }
	})
	assertTestCoverage(coverage, { eventTypes: 1, stateNodes: 1, transitions: 1 })
})
