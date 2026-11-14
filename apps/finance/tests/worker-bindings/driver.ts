/// <reference types="vite/client" />
import sharedWorkerUrl from './echo.sharedworker.js?sharedworker&url'
import {
	serveFinanceBrokerGrant,
	serveFinanceGenerationGrant
} from '../../src/lib/runtime/worker/broker-host.js'
import type { Operation, Reply } from './bindings.worker.js'

type Result = Exclude<Reply, { type: 'READY' }>
const workers = new Map<string, Worker>()
const pending = new Map<
	number,
	{
		resolve: (value: Result) => void
		reject: (error: Error) => void
		timer: ReturnType<typeof setTimeout>
	}
>()
let sequence = 0
const hosts = new Map<
	string,
	{
		release: () => void
		opens: { url: string; name: string }[]
		reads: string[]
		writes: { key: string; value: string }[]
	}
>()
function request(name: string, operation: Operation, transfers: Transferable[] = []) {
	const worker = workers.get(name)
	if (!worker) throw new Error('Fixture worker missing')
	const id = ++sequence
	return new Promise<Result>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id)
			reject(new Error('Fixture command deadline exceeded'))
		}, 5000)
		pending.set(id, { resolve, reject, timer })
		worker.postMessage({ id, operation }, transfers)
	})
}
async function attachHost(
	name: string,
	data: MessageChannel,
	control: MessageChannel,
	scope: string,
	ownership: 'root' | 'child',
	host: {
		release: () => void
		opens: { url: string; name: string }[]
		reads: string[]
		writes: { key: string; value: string }[]
	}
) {
	hosts.set(name, host)
	const initialized = await request(
		name,
		{ type: 'BROKER_INIT', data: data.port2, control: control.port2, scope, ownership },
		[data.port2, control.port2]
	)
	const identity = initialized.type === 'RESULT' ? initialized.value : undefined
	if (
		!identity ||
		typeof identity !== 'object' ||
		!('scope' in identity) ||
		identity.scope !== scope ||
		!('requestId' in identity) ||
		typeof identity.requestId !== 'string'
	)
		throw new Error('Fixture grant refused initialization')
	return { scope, requestId: identity.requestId }
}

const fixture = {
	async create(name: string) {
		if (workers.has(name)) throw new Error('Fixture worker already open')
		const worker = new Worker(new URL('./bindings.worker.ts', import.meta.url), { type: 'module' })
		workers.set(name, worker)
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Fixture worker startup exceeded')), 5000)
			worker.onerror = () => {
				clearTimeout(timer)
				reject(new Error('Fixture worker failed'))
				for (const [id, call] of pending) {
					pending.delete(id)
					clearTimeout(call.timer)
					call.reject(new Error('Fixture worker failed'))
				}
			}
			worker.onmessage = ({ data }: MessageEvent<Reply>) => {
				if (data.type === 'READY') {
					clearTimeout(timer)
					resolve()
					return
				}
				const call = pending.get(data.id)
				if (!call) return
				pending.delete(data.id)
				clearTimeout(call.timer)
				call.resolve(data)
			}
		})
	},
	request,
	async qualifyGrantProtocol() {
		const name = 'grant-protocol'
		await fixture.create(name)
		const data = new MessageChannel(),
			control = new MessageChannel(),
			orphan = new MessageChannel()
		const identity = {
			runtimeId: crypto.randomUUID(),
			grantId: crypto.randomUUID(),
			acquisitionId: crypto.randomUUID()
		}
		const envelope = { version: 1, ...identity }
		try {
			const acquisition = await request(name, {
				type: 'GRANT_FRAME',
				direction: 'request',
				frame: {
					...envelope,
					type: 'ACQUIRE_GRANT',
					descriptor: {
						kind: 'generation',
						key: 'jazz:shared-worker-generation:jazz-runtime:native-protocol'
					}
				}
			})
			const refused = await request(name, {
				type: 'GRANT_FRAME',
				direction: 'reply',
				frame: { ...envelope, type: 'GRANT_REFUSED', reason: 'rejected' }
			})
			const uncertain = await request(name, {
				type: 'GRANT_FRAME',
				direction: 'reply',
				frame: { ...envelope, type: 'GRANT_UNCERTAIN', reason: 'unavailable' }
			})
			const invalid = await request(
				name,
				{
					type: 'GRANT_FRAME',
					direction: 'reply',
					frame: { ...envelope, type: 'GRANT_UNCERTAIN', reason: 'unavailable' }
				},
				[orphan.port1]
			)
			const ready = await request(
				name,
				{
					type: 'GRANT_FRAME',
					direction: 'reply',
					frame: {
						...envelope,
						type: 'GRANT_READY',
						dataPort: data.port1,
						controlPort: control.port1
					}
				},
				[data.port1, control.port1]
			)
			const dataEcho = new Promise<unknown>((resolve) => {
				data.port2.onmessage = ({ data }) => resolve(data)
			})
			const controlEcho = new Promise<unknown>((resolve) => {
				control.port2.onmessage = ({ data }) => resolve(data)
			})
			data.port2.postMessage('data probe')
			control.port2.postMessage('control probe')
			return {
				identity,
				acquisition,
				refused,
				uncertain,
				invalid,
				ready,
				echoes: await Promise.all([dataEcho, controlEcho])
			}
		} finally {
			fixture.destroy(name)
			for (const pair of [data, control, orphan]) {
				pair.port1.close()
				pair.port2.close()
			}
		}
	},
	async bindGeneration(name: string, ownership: 'root' | 'child' = 'root') {
		const data = new MessageChannel(),
			control = new MessageChannel()
		const scope = crypto.randomUUID()
		const key = `jazz:shared-worker-generation:jazz-runtime:finance-fixture:${scope}`
		localStorage.setItem(key, 'raw SDK generation value')
		const opens: { url: string; name: string }[] = [],
			reads: string[] = [],
			writes: { key: string; value: string }[] = []
		const release = serveFinanceGenerationGrant(
			data.port1,
			control.port1,
			{ scope, key },
			{
				storage: {
					getItem: (key) => {
						reads.push(key)
						return localStorage.getItem(key)
					},
					setItem: (key, value) => {
						writes.push({ key, value })
						localStorage.setItem(key, value)
					}
				}
			}
		)
		const identity = await attachHost(name, data, control, scope, ownership, {
			release,
			opens,
			reads,
			writes
		})
		return { ...identity, key }
	},
	async bindBroker(name: string, ownership: 'root' | 'child' = 'root') {
		const data = new MessageChannel(),
			control = new MessageChannel()
		const scope = crypto.randomUUID()
		const workerName = `jazz-runtime:finance-fixture:${scope}:generation-2`
		const url = new URL(sharedWorkerUrl, location.href).href
		const opens: { url: string; name: string }[] = [],
			reads: string[] = [],
			writes: { key: string; value: string }[] = []
		const release = serveFinanceBrokerGrant(
			data.port1,
			control.port1,
			{ scope, url, name: workerName },
			{
				origin: location.origin,
				openBroker: (url, name) => {
					opens.push({ url, name })
					return new SharedWorker(url, { type: 'module', name })
				}
			}
		)
		const identity = await attachHost(name, data, control, scope, ownership, {
			release,
			opens,
			reads,
			writes
		})
		return { ...identity, url, name: workerName }
	},
	stats(name: string) {
		const host = hosts.get(name)
		if (!host) throw new Error('Fixture native host missing')
		return { opens: host.opens, reads: host.reads, writes: host.writes }
	},
	destroy(name: string) {
		hosts.get(name)?.release()
		hosts.delete(name)
		workers.get(name)?.terminate()
		workers.delete(name)
	}
}
declare global {
	interface Window {
		financeBindingFixture: typeof fixture
	}
}
window.financeBindingFixture = fixture
