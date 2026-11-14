import { z } from 'zod'
import { createActor } from 'xstate'
// This bare import resolves the packed package in the generated consumer fixture.
import { createIndexedDbAccountStore } from 'delightful-local-first/backend/jazz/account-store/indexeddb'
// Test-only internal roots qualify forced actor/native resource disposal separately.
import { createIndexedDbAccountNative } from '../../src/lib/storage/indexeddb-account-store-native.js'
import { indexedDbAccountStoreMachine } from '../../src/lib/machines/identity/indexeddb-account-store.js'

const binding = z.object({
	id: z.number().int().positive(),
	databaseName: z.string(),
	key: z.string()
})
const schema = z.discriminatedUnion('method', [
	binding.extend({
		method: z.enum([
			'open',
			'read',
			'close',
			'throw-transform',
			'oversize',
			'abort-after-put',
			'quota',
			'close-during-write',
			'version-change',
			'late-open',
			'actor-stop',
			'stop-during-begin',
			'close-failure'
		])
	}),
	binding.extend({ method: z.enum(['update', 'append']), value: z.string() }),
	binding.extend({ method: z.literal('seed'), value: z.unknown() }),
	binding.extend({ method: z.literal('burst'), count: z.number().int().min(1).max(20) }),
	binding.extend({
		method: z.literal('crash'),
		phase: z.enum(['before', 'put', 'committed']),
		value: z.string()
	})
])
export type Command = z.infer<typeof schema>
export type Payload = Command extends infer C ? (C extends Command ? Omit<C, 'id'> : never) : never
const failureSchema = z.object({ reason: z.string(), writeOutcome: z.string() })
let store: ReturnType<typeof createIndexedDbAccountStore> | undefined
function current() {
	if (!store) throw new Error('Test store missing')
	return store
}
function failure(error: unknown) {
	const parsed = failureSchema.safeParse(error)
	return parsed.success ? parsed.data : { reason: 'fixture-failed', writeOutcome: 'unknown' }
}
async function outcome(promise: Promise<unknown>) {
	try {
		await promise
		return { ok: true }
	} catch (error) {
		return { ok: false, ...failure(error) }
	}
}
async function database(name: string, version = 1) {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(name, version)
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains('selections'))
				request.result.createObjectStore('selections')
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(new Error('Fixture database open failed'))
		request.onblocked = () => reject(new Error('Fixture database open blocked'))
	})
}
async function seed(name: string, key: string, value: unknown) {
	const db = await database(name)
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('selections', 'readwrite', { durability: 'strict' })
			tx.oncomplete = () => resolve()
			tx.onabort = () => reject(new Error('Fixture write aborted'))
			tx.objectStore('selections').put(value, key)
		})
	} finally {
		db.close()
	}
}
function checkpoint(id: number, phase: string) {
	self.postMessage({ type: 'checkpoint', id, phase })
	// Intentionally keep this worker in the native callback until the browser
	// test terminates it. No timer/async boundary can accidentally commit for us.
	const deadline = performance.now() + 60_000
	while (performance.now() < deadline) {
		/* Test-only worker pause. */
	}
}
async function dispatch(command: Command): Promise<unknown> {
	const { databaseName: name, key } = command
	if (command.method === 'open') {
		store = createIndexedDbAccountStore({ databaseName: name, key })
		return current().read()
	}
	if (command.method === 'seed') {
		await seed(name, key, command.value)
		return true
	}
	if (command.method === 'late-open') {
		// Hold a genuine IDB upgrade open with native requests, not an await in
		// its callback. The store's original open queues behind it.
		let hold = true
		let entered: (() => void) | undefined
		const upgrading = new Promise<void>((resolve) => {
			entered = resolve
		})
		const first = new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(name, 1)
			request.onupgradeneeded = () => {
				const target = request.result.createObjectStore('selections')
				const keepAlive = () => {
					const read = target.get('upgrade-gate')
					read.onsuccess = () => {
						if (hold) keepAlive()
					}
				}
				keepAlive()
				entered?.()
			}
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(new Error('Fixture upgrade failed'))
		})
		await upgrading
		store = createIndexedDbAccountStore({ databaseName: name, key })
		const reading = outcome(current().read())
		let closed = false
		const closing = current()
			.close()
			.then(() => {
				closed = true
			})
		await Promise.resolve()
		await Promise.resolve()
		const premature = closed
		hold = false
		const blocker = await first
		blocker.close()
		await closing
		const next = await database(name, 2)
		next.close()
		return { premature, reading: await reading }
	}
	if (command.method === 'actor-stop' || command.method === 'stop-during-begin') {
		await seed(name, key, 'original')
		const native = createIndexedDbAccountNative({ databaseName: name, key, factory: indexedDB })
		const actor = createActor(indexedDbAccountStoreMachine, { input: { native } })
		const begin = IDBDatabase.prototype.transaction
		let aborted = false
		let calls = 0
		IDBDatabase.prototype.transaction = function (...args) {
			const tx = begin.apply(this, args)
			tx.addEventListener('abort', () => {
				aborted = true
			})
			if (command.method === 'stop-during-begin') actor.stop()
			return tx
		}
		try {
			actor.start()
			actor.send({
				type: 'CALL',
				call: {
					id: 1,
					operation: {
						kind: 'update',
						transform: () => {
							calls++
							actor.stop()
							return 'must-not-be-written'
						}
					},
					respond: () => {
						throw new Error('Stopped actor published a result')
					}
				}
			})
			await native.closed
			const checking = createIndexedDbAccountStore({ databaseName: name, key })
			try {
				return { aborted, calls, value: await checking.read() }
			} finally {
				await checking.close()
			}
		} finally {
			IDBDatabase.prototype.transaction = begin
			actor.stop()
		}
	}
	if (command.method === 'read') return current().read()
	if (command.method === 'close') {
		await current().close()
		return true
	}
	if (command.method === 'update') {
		await current().update(() => command.value)
		return true
	}
	if (command.method === 'append') {
		await current().update((value) => `${value ?? ''}${command.value},`)
		return true
	}
	if (command.method === 'throw-transform')
		return outcome(
			current().update(() => {
				throw new Error('private transform payload')
			})
		)
	if (command.method === 'oversize')
		return outcome(current().update(() => 'x'.repeat(1024 * 1024 + 1)))
	if (command.method === 'burst')
		return Promise.all(
			Array.from({ length: command.count }, () => outcome(current().update((v) => `${v ?? ''}x`)))
		)
	if (command.method === 'version-change') {
		const next = await database(name, 2)
		next.close()
		await current().close()
		return outcome(current().read())
	}
	if (command.method === 'close-failure') {
		const original = IDBDatabase.prototype.close
		const retained: IDBDatabase[] = []
		IDBDatabase.prototype.close = function () {
			retained.push(this)
			throw new Error('private native close payload')
		}
		try {
			return { closing: await outcome(current().close()), reading: await outcome(current().read()) }
		} finally {
			IDBDatabase.prototype.close = original
			for (const db of retained) db.close()
		}
	}
	if (command.method === 'crash' && command.phase === 'before') checkpoint(command.id, 'before')
	const original = IDBObjectStore.prototype.put
	let closing: Promise<void> | undefined
	const trace: string[] = []
	const begin = IDBDatabase.prototype.transaction
	if (command.method === 'close-during-write') {
		IDBDatabase.prototype.transaction = function (...args) {
			const tx = begin.apply(this, args)
			// Observe the terminal event before the production handler can settle
			// Promises; native dispatch may run microtasks between listeners.
			tx.addEventListener('complete', () => {
				trace.push('transaction-complete')
			})
			return tx
		}
	}
	IDBObjectStore.prototype.put = function (value: unknown, nativeKey?: IDBValidKey) {
		if (command.method === 'quota')
			throw new DOMException('private quota payload', 'QuotaExceededError')
		const request = original.call(this, value, nativeKey)
		const tx = this.transaction
		request.addEventListener('success', () => {
			if (command.method === 'abort-after-put') tx.abort()
			if (command.method === 'close-during-write') {
				trace.push('put-success')
				closing = current()
					.close()
					.then(() => {
						trace.push('closed')
					})
			}
			if (command.method === 'crash' && command.phase === 'put') checkpoint(command.id, 'put')
		})
		return request
	}
	try {
		const value = command.method === 'crash' ? command.value : 'replacement'
		const updating = outcome(current().update(() => value))
		if (command.method === 'close-during-write') {
			const queued = outcome(current().update(() => 'must-not-run'))
			const first = await updating
			if (!closing) throw new Error('Close hook did not run')
			await closing
			return { first, queued: await queued, trace }
		}
		const result = await updating
		if (command.method === 'crash' && command.phase === 'committed')
			checkpoint(command.id, 'committed')
		return result
	} finally {
		IDBObjectStore.prototype.put = original
		IDBDatabase.prototype.transaction = begin
	}
}
self.onmessage = ({ data }: MessageEvent<unknown>) => {
	const command = schema.parse(data)
	self.postMessage({ type: 'checkpoint', id: command.id, phase: `received-${command.method}` })
	void dispatch(command).then(
		(value) => self.postMessage({ type: 'result', id: command.id, value }),
		(error: unknown) => self.postMessage({ type: 'error', id: command.id, error: failure(error) })
	)
}

self.postMessage({ type: 'checkpoint', id: 0, phase: 'ready' })
