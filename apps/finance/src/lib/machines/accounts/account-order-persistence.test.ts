import { createActor, waitFor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import {
	createAccountOrderPersistenceMachine,
	selectPersistedAccountOrder
} from './account-order-persistence.js'
import type { AccountOrderStorage } from '../../contracts/worker-forms.js'
function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason: Error) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
function fixture(storage: AccountOrderStorage) {
	const actor = createActor(createAccountOrderPersistenceMachine(storage), {
		input: { observation: { key: 'one', ids: ['a', 'b', 'c'] } }
	}).start()
	const view = () => selectPersistedAccountOrder(actor.getSnapshot())?.view
	const command = (command: Parameters<typeof actor.send>[0] & { type: 'COMMAND' }) =>
		actor.send(command)
	const move = (id: string, direction: 'up' | 'down') =>
		command({ type: 'COMMAND', command: { type: 'MOVE', id, direction } })
	const edit = () => command({ type: 'COMMAND', command: { type: 'EDIT' } })
	const ready = () => waitFor(actor, (s) => !!selectPersistedAccountOrder(s))
	return { actor, view, move, edit, ready }
}
describe('worker account-order persistence', () => {
	it('loads preferences, reuses editor guards and writes only accepted moves', async () => {
		const write = vi.fn(async () => {})
		const f = fixture({ read: async () => ['c', 'a'], write })
		try {
			await f.ready()
			expect(f.view()?.ids).toEqual(['c', 'a', 'b'])
			f.move('a', 'up')
			expect(write).not.toHaveBeenCalled()
			f.edit()
			f.move('c', 'up')
			f.move('missing', 'down')
			expect(write).not.toHaveBeenCalled()
			f.move('b', 'up')
			await waitFor(f.actor, (s) => s.matches('ready'))
			expect(write).toHaveBeenCalledExactlyOnceWith('one', ['c', 'b', 'a'])
			f.actor.send({ type: 'COMMAND', command: { type: 'DONE' } })
			expect(f.view()?.editing).toBe(false)
		} finally {
			f.actor.stop()
		}
	})
	it('coalesces rapid moves after the actual issued write settles', async () => {
		const receipt = deferred<void>()
		const write = vi.fn(async (_key: string, _ids: readonly string[]) => {})
		write.mockImplementationOnce(() => receipt.promise)
		const f = fixture({ read: async () => [], write })
		try {
			await f.ready()
			f.edit()
			f.move('b', 'up')
			f.move('c', 'up')
			f.move('c', 'up')
			expect(f.view()?.ids).toEqual(['c', 'b', 'a'])
			expect(write).toHaveBeenCalledTimes(1)
			receipt.resolve()
			await waitFor(f.actor, (s) => s.matches('ready'))
			expect(write.mock.calls).toEqual([
				['one', ['b', 'a', 'c']],
				['one', ['c', 'b', 'a']]
			])
		} finally {
			f.actor.stop()
		}
	})
	it('withdraws old scope while saving and reads only the latest workspace afterwards', async () => {
		const receipt = deferred<void>(),
			read = vi.fn(async (_key: string) => [])
		const write = vi.fn(() => receipt.promise),
			f = fixture({ read, write })
		try {
			await f.ready()
			f.edit()
			f.move('b', 'up')
			f.actor.send({ type: 'OBSERVE', observation: { key: 'two', ids: ['x', 'y'] } })
			f.actor.send({ type: 'OBSERVE', observation: { key: 'three', ids: ['m', 'n'] } })
			f.move('b', 'down')
			expect(f.view()).toBeUndefined()
			expect(read).toHaveBeenCalledTimes(1)
			receipt.resolve()
			await f.ready()
			expect(read.mock.calls).toEqual([['one'], ['three']])
			expect(f.view()?.ids).toEqual(['m', 'n'])
			expect(f.view()?.editing).toBe(false)
			f.edit()
			f.move('n', 'up')
			await waitFor(f.actor, (s) => s.matches('ready'))
			expect(write).toHaveBeenLastCalledWith('three', ['n', 'm'])
		} finally {
			f.actor.stop()
		}
	})
	it.each(['shutdown', 'workspace'])(
		'flushes the latest accepted moves before %s',
		async (next) => {
			const first = deferred<void>(),
				second = deferred<void>()
			const write = vi
				.fn((_key: string, _ids: readonly string[]) => second.promise)
				.mockImplementationOnce(() => first.promise)
			const f = fixture({ read: async () => [], write })
			try {
				await f.ready()
				f.edit()
				f.move('b', 'up')
				f.move('c', 'up')
				f.move('c', 'up')
				if (next === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
				else f.actor.send({ type: 'OBSERVE', observation: { key: 'two', ids: ['x', 'y'] } })
				first.resolve()
				await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
				expect(write).toHaveBeenLastCalledWith('one', ['c', 'b', 'a'])
				expect(f.actor.getSnapshot().status).toBe('active')
				expect(f.view()).toBeUndefined()
				second.resolve()
				if (next === 'shutdown') await waitFor(f.actor, (s) => s.status === 'done')
				else {
					await f.ready()
					expect(f.view()?.ids).toEqual(['x', 'y'])
				}
			} finally {
				first.resolve()
				second.resolve()
				f.actor.stop()
			}
		}
	)
	it.each(['read', 'write'])(
		'waits for held %s before acknowledging shutdown',
		async (operation) => {
			const read = deferred<readonly string[]>(),
				write = deferred<void>()
			const f = fixture({
				read: () => (operation === 'read' ? read.promise : Promise.resolve([])),
				write: () => write.promise
			})
			try {
				if (operation === 'write') {
					await f.ready()
					f.edit()
					f.move('b', 'up')
				}
				f.actor.send({ type: 'SHUTDOWN' })
				f.actor.send({ type: 'OBSERVE', observation: { key: 'two', ids: ['x', 'y'] } })
				f.edit()
				expect(f.actor.getSnapshot().status).toBe('active')
				expect(f.view()).toBeUndefined()
				if (operation === 'read') read.resolve([])
				else write.resolve()
				await waitFor(f.actor, (s) => s.status === 'done')
			} finally {
				f.actor.stop()
			}
		}
	)
	it.each(['read', 'write'])(
		'keeps session ordering usable after %s failure without automatic retries',
		async (operation) => {
			const read = vi.fn(async () => {
				if (operation === 'read') throw new Error('denied')
				return []
			})
			const write = vi.fn(async () => {
				throw new Error('quota')
			})
			const f = fixture({ read, write })
			try {
				await f.ready()
				f.edit()
				f.move('b', 'up')
				await waitFor(f.actor, (s) => s.matches('unavailable'))
				f.move('c', 'up')
				expect(f.view()?.ids).toEqual(['b', 'c', 'a'])
				expect(read).toHaveBeenCalledTimes(1)
				expect(write).toHaveBeenCalledTimes(operation === 'read' ? 0 : 1)
				f.actor.send({ type: 'SHUTDOWN' })
				expect(f.actor.getSnapshot().status).toBe('done')
			} finally {
				f.actor.stop()
			}
		}
	)
	it('retains the latest same-workspace intent through A to B to A while a write is held', async () => {
		const receipt = deferred<void>(),
			read = vi.fn(async () => []),
			write = vi.fn(() => receipt.promise)
		const f = fixture({ read, write })
		try {
			await f.ready()
			f.edit()
			f.move('b', 'up')
			f.actor.send({ type: 'OBSERVE', observation: { key: 'two', ids: ['x'] } })
			f.actor.send({ type: 'OBSERVE', observation: { key: 'one', ids: ['a', 'b', 'c', 'd'] } })
			expect(f.view()?.ids).toEqual(['b', 'a', 'c', 'd'])
			receipt.resolve()
			await waitFor(f.actor, (s) => s.matches('ready'))
			expect(read).toHaveBeenCalledTimes(1)
			expect(write).toHaveBeenCalledTimes(1)
			expect(f.view()?.ids).toEqual(['b', 'a', 'c', 'd'])
		} finally {
			f.actor.stop()
		}
	})
})
