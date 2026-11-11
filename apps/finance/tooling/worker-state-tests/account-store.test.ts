import { expect, it, vi } from 'vitest'
import { waitFor, toPromise } from 'xstate'
import { fixture, roots, selection, legacyScope } from './account-store.test-support.js'
import { WorkerHostError } from '../../src/lib/runtime/worker/host-protocol.js'
const registry = `https://old.example/apps/${legacyScope}/accounts`
const update = { kind: 'update', transform: () => selection([roots[2]!]) } satisfies Parameters<
	typeof fixture
>[0]

it('reads primary selection without choosing an earlier identity or writing', async () => {
	const current = selection([roots[0]!]),
		f = fixture(
			{ kind: 'read' },
			{ current, earlier: [{ registry, value: selection([roots[1]!]) }] }
		)
	expect(await toPromise(f.actor)).toEqual({ kind: 'read', value: current })
	expect(f.storage.writePrimary).not.toHaveBeenCalled()
	expect(await f.held()).toBe(false)
})
it('reuses exactly one readable earlier selection without creating a new store', async () => {
	const earlier = selection([roots[1]!]),
		f = fixture({ kind: 'read' }, { current: null, earlier: [{ registry, value: earlier }] })
	expect(await toPromise(f.actor)).toEqual({ kind: 'read', value: earlier })
	expect(f.values.has(f.binding.key)).toBe(false)
})
it('does not guess between ambiguous earlier stores', async () => {
	const f = fixture(
		{ kind: 'read' },
		{
			current: null,
			earlier: [
				{ registry, value: selection([roots[0]!]) },
				{
					registry: `https://another.example/apps/${legacyScope}/accounts`,
					value: selection([roots[1]!])
				}
			]
		}
	)
	expect(await toPromise(f.actor)).toEqual({ kind: 'read', value: null })
	expect(f.values.size).toBe(2)
})
it('acknowledges primary storage before scrubbing only the dropped earlier roots', async () => {
	const earlier = selection([roots[0]!, roots[1]!, roots[2]!], 1, { future: 'preserve' })
	const f = fixture(update, { earlier: [{ registry, value: earlier }] })
	await f.enteredWrite.promise
	expect(await f.held()).toBe(true)
	f.defaultWrite.resolve()
	expect(await toPromise(f.actor)).toEqual({ kind: 'updated', legacyCleanup: 'complete' })
	expect(JSON.parse(f.values.get(f.legacyKey(registry))!)).toMatchObject({
		roots: [roots[1], roots[2]],
		selected: 0,
		future: 'preserve'
	})
	expect(f.trace.indexOf('write-acknowledged')).toBeLessThan(f.trace.indexOf('legacy-write'))
	expect(await f.held()).toBe(false)
	expect(f.actor.getSnapshot().context.request).toBeUndefined()
	expect(f.actor.getSnapshot().context.replacement).toBeUndefined()
})
it('discovers an earlier store created while the primary write was in flight', async () => {
	const f = fixture(update, {
		afterWrite: (values, key) => values.set(key(registry), selection([roots[0]!, roots[1]!]))
	})
	await f.enteredWrite.promise
	f.defaultWrite.resolve()
	expect(await toPromise(f.actor)).toEqual({ kind: 'updated', legacyCleanup: 'complete' })
	expect(JSON.parse(f.values.get(f.legacyKey(registry))!)).toMatchObject({
		roots: [roots[1]],
		selected: null
	})
})
it('cancels a queued lock acquisition without calling the SDK transform or storage write', async () => {
	const externalRelease = Promise.withResolvers<void>(),
		acquired = Promise.withResolvers<void>()
	const transform = vi.fn(() => selection([roots[2]!]))
	const f = fixture({ kind: 'update', transform }, { start: false })
	const external = navigator.locks.request(f.binding.key, async () => {
		acquired.resolve()
		await externalRelease.promise
	})
	await acquired.promise
	f.actor.start()
	f.actor.send({ type: 'SHUTDOWN' })
	try {
		expect(await toPromise(f.actor)).toEqual({ kind: 'canceled' })
		expect(transform).not.toHaveBeenCalled()
		expect(f.storage.writePrimary).not.toHaveBeenCalled()
	} finally {
		externalRelease.resolve()
		await external
	}
})
it('waits for a canceled read and never starts the selected write', async () => {
	const read = Promise.withResolvers<void>(),
		f = fixture(update, { readGate: read.promise })
	await vi.waitFor(() => expect(f.storage.readSnapshot).toHaveBeenCalledOnce())
	f.actor.send({ type: 'SHUTDOWN' })
	expect(await f.held()).toBe(true)
	read.resolve()
	expect(await toPromise(f.actor)).toEqual({ kind: 'canceled' })
	expect(f.storage.writePrimary).not.toHaveBeenCalled()
	expect(await f.held()).toBe(false)
})
it('rejects an invalid transform before issuing or draining a native write', async () => {
	const f = fixture({ kind: 'update', transform: () => 'invalid-selection' })
	expect(await toPromise(f.actor)).toEqual({ kind: 'failed', writeOutcome: 'not-issued' })
	expect(f.storage.writePrimary).not.toHaveBeenCalled()
	expect(f.storage.closeHostAndDrain).not.toHaveBeenCalled()
	expect(await f.held()).toBe(false)
})
it('releases a confirmed-unissued write without claiming an uncertain commit', async () => {
	const f = fixture(update)
	await f.enteredWrite.promise
	f.defaultWrite.reject(new WorkerHostError('rejected', 'not-issued'))
	expect(await toPromise(f.actor)).toEqual({ kind: 'failed', writeOutcome: 'not-issued' })
	expect(f.storage.closeHostAndDrain).not.toHaveBeenCalled()
	expect(await f.held()).toBe(false)
})
it('retains unknown-write custody after failed host drain until a matching native close receipt', async () => {
	const f = fixture(update)
	await f.enteredWrite.promise
	f.defaultWrite.reject(new WorkerHostError('timeout', 'unknown'))
	await f.enteredClose.promise
	f.defaultClose.reject(new Error('no close receipt'))
	await waitFor(f.actor, (snapshot) => snapshot.matches({ updating: { work: 'retained' } }))
	f.actor.send({ type: 'HOST_CLOSED', scope: crypto.randomUUID() })
	expect(await f.held()).toBe(true)
	expect(f.actor.getSnapshot().status).toBe('active')
	f.closeHost()
	expect(await toPromise(f.actor)).toEqual({ kind: 'failed', writeOutcome: 'unknown' })
	expect(await f.held()).toBe(false)
	expect(f.storage.writePrimary).toHaveBeenCalledOnce()
})
