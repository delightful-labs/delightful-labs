import { getCurrentJazzSession } from './session.js'
let releasePreparation: (() => void) | undefined
export function holdWorkspacePreparation() {
	const digest = crypto.subtle.digest.bind(crypto.subtle)
	const pending = Promise.withResolvers<void>()
	crypto.subtle.digest = (algorithm, data) => pending.promise.then(() => digest(algorithm, data))
	releasePreparation = () => {
		crypto.subtle.digest = digest
		pending.resolve()
	}
}
export function releaseWorkspacePreparation() {
	releasePreparation?.()
	releasePreparation = undefined
}
const createHeldWorkspaceWrite = async (kind: 'transfer' | 'bank') => {
	const { getCurrentJazzSession }: typeof import('./session.js') = await import('./session.js')
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const session = getCurrentJazzSession()
	const db = session?.getSnapshot().client?.db
	if (!session || !db) throw new Error('Missing SDK session')
	const gate = Promise.withResolvers<void>()
	let started = false
	let restores = 0
	let restoring = false
	// Observe the SDK's public operation transition, as the authentication fixtures do.
	// Do not replace a method on a session facade that may delegate to another owner.
	const unsubscribe = session.subscribe(() => {
		const next = session.getSnapshot().pending === 'restoreDeviceAccount'
		if (next && !restoring) restores += 1
		restoring = next
	})
	const begin = db.beginTransaction.bind(db)
	const descriptor = Object.getOwnPropertyDescriptor(db, 'insert')
	const insert = db.insert
	let armed = true
	if (kind === 'transfer') {
		Object.defineProperty(db, 'beginTransaction', {
			configurable: true,
			writable: true,
			value: (...args: Parameters<typeof begin>) => {
				const transaction = begin(...args)
				if (!armed) return transaction
				armed = false
				const commit = transaction.commit.bind(transaction)
				transaction.commit = (...args) => {
					const handle = commit(...args)
					const wait = handle.wait.bind(handle)
					handle.wait = async (...options) => {
						const [option] = options
						const result = await wait({ tier: option.tier })
						started = true
						await gate.promise
						return result
					}
					return handle
				}
				return transaction
			}
		})
	} else {
		Object.defineProperty(db, 'insert', {
			configurable: true,
			writable: true,
			value: function (this: object, ...args: unknown[]): unknown {
				const handle: unknown = Reflect.apply(insert, this, args)
				if (!armed || args[0] !== app.transactions) return handle
				armed = false
				if (
					!handle ||
					typeof handle !== 'object' ||
					!('wait' in handle) ||
					typeof handle.wait !== 'function'
				)
					throw new Error('Missing SDK write acknowledgement')
				const wait = handle.wait
				Object.defineProperty(handle, 'wait', {
					configurable: true,
					writable: true,
					value: async (...options: unknown[]) => {
						const result: unknown = await Reflect.apply(wait, handle, options)
						started = true
						await gate.promise
						return result
					}
				})
				return handle
			}
		})
	}
	return {
		get started() {
			return started
		},
		get restores() {
			return restores
		},
		snapshot: () => {
			const value = session.getSnapshot()
			return {
				status: value.status,
				pending: value.pending ?? null,
				hasClient: Boolean(value.client),
				errorName: value.error?.name ?? null
			}
		},
		release: () => gate.resolve(),
		restore: () => {
			Object.defineProperty(db, 'beginTransaction', {
				configurable: true,
				writable: true,
				value: begin
			})
			if (descriptor) Object.defineProperty(db, 'insert', descriptor)
			else Reflect.deleteProperty(db, 'insert')
			unsubscribe()
			gate.resolve()
		}
	}
}
let held: Awaited<ReturnType<typeof createHeldWorkspaceWrite>> | undefined
function requiredHeld() {
	if (!held) throw new Error('Write gate is not installed')
	return held
}
export async function installWorkspaceWrite(kind: 'transfer' | 'bank') {
	held = await createHeldWorkspaceWrite(kind)
}
export function workspaceWriteStatus() {
	const value = requiredHeld()
	return { started: value.started, restores: value.restores, snapshot: value.snapshot() }
}
export function releaseWorkspaceWrite() {
	requiredHeld().release()
}
export function restoreWorkspaceWrite() {
	requiredHeld().restore()
	held = undefined
}
const createReadMetrics = async () => {
	const sessionPath = '/src/lib/runtime/jazz-session.ts'
	const { getCurrentJazzSession }: typeof import('./session.js') = await import('./session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const original = db.all,
		descriptor = Object.getOwnPropertyDescriptor(db, 'all')
	let queries = 0
	Object.defineProperty(db, 'all', {
		configurable: true,
		writable: true,
		value: function (this: object, ...args: unknown[]): unknown {
			queries += 1
			return Reflect.apply(original, this, args)
		}
	})
	return {
		get queries() {
			return queries
		},
		restore() {
			if (descriptor) Object.defineProperty(db, 'all', descriptor)
			else Reflect.deleteProperty(db, 'all')
		}
	}
}
let metrics: Awaited<ReturnType<typeof createReadMetrics>> | undefined
export async function installReadMetrics() {
	metrics = await createReadMetrics()
}
export function readMetrics() {
	if (!metrics) throw new Error('Read metrics not installed')
	return metrics.queries
}
export function restoreReadMetrics() {
	metrics?.restore()
	metrics = undefined
}
let restoreCalls = 0
let stopRestoreCount: (() => void) | undefined
export function countRestores() {
	const session = getCurrentJazzSession()
	if (!session) throw new Error('Session unavailable')
	stopRestoreCount?.()
	restoreCalls = 0
	let restoring = false
	stopRestoreCount = session.subscribe(() => {
		const next = session.getSnapshot().pending === 'restoreDeviceAccount'
		if (next && !restoring) restoreCalls++
		restoring = next
	})
}
export function restoreCount() {
	return restoreCalls
}
export async function replaceDeviceAccount() {
	const session = getCurrentJazzSession()
	if (!session) throw new Error('Session unavailable')
	await session.createDeviceAccount()
}
