import { afterEach, expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { accountStoreOwnerMachine } from '../../src/lib/machines/runtime/account-store-owner.js'
import { createWorkerAccountStore } from '../../src/lib/runtime/worker/account-store-facade.js'
import { accountStorageBinding } from '../../src/lib/runtime/worker/account-selection.js'
import { WorkerHostError } from '../../src/lib/runtime/worker/host-protocol.js'
import { roots, selection } from './account-store.test-support.js'

const cleanups = new Set<() => Promise<void>>()
afterEach(async () => {
	for (const close of cleanups) await close()
	cleanups.clear()
})
function fixture() {
	const binding = accountStorageBinding('https://finance.example/accounts', crypto.randomUUID())
	const scope = crypto.randomUUID(),
		write = Promise.withResolvers<void>(),
		drain = Promise.withResolvers<void>()
	let current = selection([roots[0]!]),
		closed = false
	const storage = {
		scope,
		readSnapshot: vi.fn(async () => ({ current, earlier: [] })),
		writePrimary: vi.fn(async (value: string) => {
			await write.promise
			if (closed) throw new WorkerHostError('closed', 'not-issued')
			current = value
		}),
		readEarlier: vi.fn(async () => null),
		writeEarlier: vi.fn(async () => {}),
		closeHostAndDrain: vi.fn(async () => {
			await drain.promise
			closed = true
		})
	}
	const actor = createActor(accountStoreOwnerMachine, {
		input: { binding, storage, locks: navigator.locks }
	}).start()
	const store = createWorkerAccountStore(actor)
	const close = () => {
		closed = true
		drain.resolve()
		actor.send({ type: 'HOST_CLOSED', scope })
	}
	cleanups.add(async () => {
		if (actor.getSnapshot().status === 'active') {
			actor.send({ type: 'SHUTDOWN' })
			close()
			write.resolve()
		}
		await toPromise(actor)
		actor.stop()
	})
	return {
		actor,
		store,
		storage,
		write,
		drain,
		close,
		binding,
		held: async () =>
			(await navigator.locks.query()).held?.some((lock) => lock.name === binding.key) ?? false
	}
}
it('maps SDK reads and serializes transforms in FIFO order without retry', async () => {
	const f = fixture(),
		order: number[] = []
	const first = f.store.update((value) => {
		order.push(1)
		expect(value).toBe(selection([roots[0]!]))
		return selection([roots[1]!])
	})
	const second = f.store.update((value) => {
		order.push(2)
		expect(value).toBe(selection([roots[1]!]))
		return selection([roots[2]!])
	})
	await vi.waitFor(() => expect(f.storage.writePrimary).toHaveBeenCalledOnce())
	expect(order).toEqual([1])
	f.write.resolve()
	await Promise.all([first, second])
	expect(await f.store.read()).toBe(selection([roots[2]!]))
	expect(order).toEqual([1, 2])
	expect(await f.held()).toBe(false)
})
it('bounds active plus queued SDK calls at eight', async () => {
	const f = fixture(),
		transform = vi.fn(() => selection([roots[1]!]))
	const pending = Array.from({ length: 8 }, () => f.store.update(transform))
	await expect(f.store.update(transform)).rejects.toMatchObject({
		reason: 'overloaded',
		writeOutcome: 'not-issued'
	})
	f.write.resolve()
	await Promise.all(pending)
	expect(transform).toHaveBeenCalledTimes(8)
})
it('shuts down an idle owner and rejects later SDK work', async () => {
	const f = fixture()
	f.actor.send({ type: 'SHUTDOWN' })
	await toPromise(f.actor)
	await expect(f.store.read()).rejects.toMatchObject({
		reason: 'closed',
		writeOutcome: 'not-issued'
	})
	expect(f.storage.writePrimary).not.toHaveBeenCalled()
})
it('cancels queued SDK work while retaining an issued write through shutdown', async () => {
	const f = fixture(),
		first = f.store.update(() => selection([roots[1]!]))
	await vi.waitFor(() => expect(f.storage.writePrimary).toHaveBeenCalledOnce())
	const queued = expect(f.store.update(() => selection([roots[2]!]))).rejects.toMatchObject({
		reason: 'closed',
		writeOutcome: 'not-issued'
	})
	f.actor.send({ type: 'SHUTDOWN' })
	await queued
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(await f.held()).toBe(true)
	f.write.resolve()
	await first
	await toPromise(f.actor)
	expect(f.storage.writePrimary).toHaveBeenCalledOnce()
	expect(await f.held()).toBe(false)
})
it('retains an uncertain issued write and ignores stale close receipts', async () => {
	const f = fixture()
	const first = expect(f.store.update(() => selection([roots[1]!]))).rejects.toMatchObject({
		writeOutcome: 'unknown'
	})
	await vi.waitFor(() => expect(f.storage.writePrimary).toHaveBeenCalledOnce())
	const queued = expect(f.store.read()).rejects.toMatchObject({
		reason: 'closed',
		writeOutcome: 'not-issued'
	})
	f.write.reject(new WorkerHostError('timeout', 'unknown'))
	await vi.waitFor(() => expect(f.storage.closeHostAndDrain).toHaveBeenCalledOnce())
	f.drain.reject(new Error('no close receipt'))
	const operation = f.actor.getSnapshot().children.operation
	if (!operation) throw new Error('Missing operation child')
	await waitFor(operation, (snapshot) => snapshot.matches({ updating: { work: 'retained' } }))
	f.actor.send({ type: 'HOST_CLOSED', scope: crypto.randomUUID() })
	expect(await f.held()).toBe(true)
	f.close()
	await Promise.all([first, queued])
	await toPromise(f.actor)
	expect(await f.held()).toBe(false)
	expect(f.storage.writePrimary).toHaveBeenCalledOnce()
})
it('closes admission when a failed write completes only after native host drain', async () => {
	const f = fixture()
	const failed = expect(f.store.update(() => selection([roots[1]!]))).rejects.toMatchObject({
		writeOutcome: 'unknown'
	})
	await vi.waitFor(() => expect(f.storage.writePrimary).toHaveBeenCalledOnce())
	const queued = expect(f.store.read()).rejects.toMatchObject({ reason: 'closed' })
	f.write.reject(new WorkerHostError('timeout', 'unknown'))
	await vi.waitFor(() => expect(f.storage.closeHostAndDrain).toHaveBeenCalledOnce())
	f.drain.resolve()
	await Promise.all([failed, queued])
	await toPromise(f.actor)
	expect(f.storage.readSnapshot).toHaveBeenCalledOnce()
})
