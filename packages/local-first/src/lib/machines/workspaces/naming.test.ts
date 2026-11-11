import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { createWorkspaceNamingOperation } from './naming.js'
import type {
	WorkspaceNamingCapability,
	WorkspaceNamingEvent,
	WorkspaceNamingRequest
} from '../../contracts/workspace-naming.js'

type Scope = { binding: object; generation: number }
type Settings = { currency: 'USD' | 'TZS' }
type Receipt = { token: object }
type Capability = WorkspaceNamingCapability<Scope, Settings, 'denied' | 'unavailable', Receipt>
const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function deferred<Value>() {
	let resolve!: (value: Value) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<Value>((accept, fail) => {
		resolve = accept
		reject = fail
	})
	return { promise, resolve, reject }
}
function fixture(name = '  Shared workspace  ') {
	const request: WorkspaceNamingRequest<Scope, Settings> = {
		scope: { binding: {}, generation: 3 },
		workspaceId: 'workspace',
		name,
		settings: { currency: 'TZS' }
	}
	const receipt = { token: {} }
	const capability = {
		assess: vi.fn<Capability['assess']>(() => ({ kind: 'allowed' })),
		issue: vi.fn<Capability['issue']>(() => ({ write: receipt })),
		persistLocal: vi.fn<Capability['persistLocal']>(() => undefined)
	}
	const actor = createActor(createWorkspaceNamingOperation(capability), { input: { request } })
	actors.add(actor)
	return {
		request,
		receipt,
		capability,
		actor,
		at: (work: 'issuing' | 'persisting') =>
			waitFor(actor, (snapshot) => snapshot.matches({ writing: { work } }), { timeout: 1_000 }),
		done: async () =>
			(await waitFor(actor, (snapshot) => snapshot.status === 'done', { timeout: 1_000 })).output
	}
}
const interruptions = [
	{ type: 'CANCEL', outcome: 'cancelled' },
	{ type: 'INVALIDATE', outcome: 'invalidated' },
	{ type: 'SHUTDOWN', outcome: 'closed' }
] satisfies {
	type: WorkspaceNamingEvent['type']
	outcome: 'cancelled' | 'invalidated' | 'closed'
}[]

describe('workspace naming operation', () => {
	it('normalizes the name, preserves scope and companion settings, and waits for local persistence', async () => {
		const f = fixture()
		const local = deferred<void>()
		f.capability.persistLocal.mockReturnValue(local.promise)
		f.actor.start()
		await f.at('persisting')
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.capability.assess).toHaveBeenCalledExactlyOnceWith({
			...f.request,
			name: 'Shared workspace'
		})
		expect(f.capability.issue).toHaveBeenCalledExactlyOnceWith({
			...f.request,
			name: 'Shared workspace'
		})
		expect(f.capability.persistLocal).toHaveBeenCalledExactlyOnceWith(f.receipt)
		local.resolve()
		const result = await f.done()
		expect(result).toMatchObject({ outcome: 'succeeded', settlement: { kind: 'locallyPersisted' } })
		expect(result?.request.scope).toBe(f.request.scope)
		expect(result?.request.settings).toBe(f.request.settings)
		expect(f.request.name).toBe('  Shared workspace  ')
		expect(f.actor.getSnapshot().context.write).toBeUndefined()
	})
	it('rejects an empty canonical name without assessment or a write', async () => {
		const f = fixture(' \t ')
		f.actor.start()
		expect(await f.done()).toMatchObject({
			outcome: 'invalid',
			settlement: { kind: 'notStarted' },
			request: { name: '' }
		})
		expect(f.capability.assess).not.toHaveBeenCalled()
		expect(f.capability.issue).not.toHaveBeenCalled()
	})
	it.each(['denied', 'unavailable'] satisfies ('denied' | 'unavailable')[])(
		'preserves host %s without issuing a write',
		async (reason) => {
			const f = fixture()
			f.capability.assess.mockReturnValue({ kind: 'blocked', reason })
			f.actor.start()
			expect(await f.done()).toMatchObject({
				outcome: 'blocked',
				reason,
				settlement: { kind: 'notStarted' }
			})
			expect(f.capability.issue).not.toHaveBeenCalled()
		}
	)
	it('reports a throwing local assessment as not started', async () => {
		const f = fixture()
		const error = new Error('Local assessment failed')
		f.capability.assess.mockImplementation(() => {
			throw error
		})
		f.actor.start()
		expect(await f.done()).toMatchObject({
			outcome: 'failed',
			error,
			settlement: { kind: 'notStarted' }
		})
		expect(f.capability.issue).not.toHaveBeenCalled()
	})
	it.each(interruptions)('prevents issue after early $type', async ({ type, outcome }) => {
		const f = fixture()
		f.actor.start()
		f.actor.send({ type })
		expect(await f.done()).toMatchObject({ outcome, settlement: { kind: 'notStarted' } })
		await Promise.resolve()
		expect(f.capability.issue).not.toHaveBeenCalled()
		expect(f.capability.persistLocal).not.toHaveBeenCalled()
	})
	for (const work of ['issuing', 'persisting'] satisfies ('issuing' | 'persisting')[]) {
		it.each(interruptions)(
			`drains ${work} after $type and retains successful settlement`,
			async ({ type, outcome }) => {
				const f = fixture()
				const issued = deferred<{ write: Receipt }>()
				const local = deferred<void>()
				f.capability.issue.mockReturnValue(issued.promise)
				f.capability.persistLocal.mockReturnValue(local.promise)
				f.actor.start()
				await f.at('issuing')
				if (work === 'persisting') {
					issued.resolve({ write: f.receipt })
					await f.at('persisting')
				}
				f.actor.send({ type })
				expect(f.actor.getSnapshot().status).toBe('active')
				if (work === 'issuing') {
					issued.resolve({ write: f.receipt })
					await f.at('persisting')
				}
				expect(f.actor.getSnapshot().status).toBe('active')
				local.resolve()
				expect(await f.done()).toMatchObject({ outcome, settlement: { kind: 'locallyPersisted' } })
				expect(f.capability.issue).toHaveBeenCalledTimes(1)
				expect(f.capability.persistLocal).toHaveBeenCalledExactlyOnceWith(f.receipt)
				expect(f.actor.getSnapshot().context.write).toBeUndefined()
			}
		)
		it(`retains unknown settlement after ${work} rejects, with no automatic replay`, async () => {
			const f = fixture()
			const error = new Error('Uncertain write')
			if (work === 'issuing') f.capability.issue.mockRejectedValue(error)
			else f.capability.persistLocal.mockRejectedValue(error)
			f.actor.start()
			expect(await f.done()).toMatchObject({
				outcome: 'failed',
				error,
				settlement: { kind: 'unknown', error }
			})
			f.actor.send({ type: 'CANCEL' })
			f.actor.send({ type: 'SHUTDOWN' })
			expect(f.capability.issue).toHaveBeenCalledTimes(1)
			expect(f.capability.persistLocal).toHaveBeenCalledTimes(work === 'issuing' ? 0 : 1)
		})
	}
	it('preserves shutdown precedence and unknown settlement when a late issue fails', async () => {
		const f = fixture()
		const issued = deferred<{ write: Receipt }>()
		const error = new Error('Issue outcome unknown')
		f.capability.issue.mockReturnValue(issued.promise)
		f.actor.start()
		await f.at('issuing')
		f.actor.send({ type: 'CANCEL' })
		f.actor.send({ type: 'INVALIDATE' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'CANCEL' })
		f.actor.send({ type: 'INVALIDATE' })
		expect(f.actor.getSnapshot().status).toBe('active')
		issued.reject(error)
		expect(await f.done()).toMatchObject({
			outcome: 'closed',
			settlement: { kind: 'unknown', error }
		})
		expect(f.capability.persistLocal).not.toHaveBeenCalled()
	})
	it('preserves invalidation precedence over cancellation while persistence finishes', async () => {
		const f = fixture()
		const local = deferred<void>()
		f.capability.persistLocal.mockReturnValue(local.promise)
		f.actor.start()
		await f.at('persisting')
		f.actor.send({ type: 'CANCEL' })
		f.actor.send({ type: 'INVALIDATE' })
		f.actor.send({ type: 'CANCEL' })
		local.resolve()
		expect(await f.done()).toMatchObject({
			outcome: 'invalidated',
			settlement: { kind: 'locallyPersisted' }
		})
	})
	it('keeps a thenable SDK receipt opaque until the explicit local wait', async () => {
		const then = vi.fn(() => {
			throw new Error('Implicit receipt assimilation')
		})
		// oxlint-disable-next-line unicorn/no-thenable -- Deliberately detect accidental SDK receipt assimilation.
		const receipt = { then, local: Promise.resolve() }
		const persistLocal = vi.fn((write: typeof receipt) => write.local)
		const request = fixture().request
		const capability: WorkspaceNamingCapability<Scope, Settings, never, typeof receipt> = {
			assess: () => ({ kind: 'allowed' }),
			issue: () => ({ write: receipt }),
			persistLocal
		}
		const actor = createActor(createWorkspaceNamingOperation(capability), {
			input: { request }
		}).start()
		actors.add(actor)
		const result = (
			await waitFor(actor, (snapshot) => snapshot.status === 'done', { timeout: 1_000 })
		).output
		expect(result?.outcome).toBe('succeeded')
		expect(then).not.toHaveBeenCalled()
		expect(persistLocal).toHaveBeenCalledExactlyOnceWith(receipt)
	})
})
