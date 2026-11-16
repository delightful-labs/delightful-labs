import { serveBrokerHost } from 'delightful-local-first/backend/jazz/worker-broker'
import type { SdkCommand, SdkReply } from './sdk-session.worker.js'
import wasmUrl from '#jazz-wasm-binary?url'

let active:
	{ worker: Worker; release: () => void; stats: { opens: number; reads: number } } | undefined
function command(operation: SdkCommand) {
	if (!active) throw new Error('SDK fixture worker unavailable')
	const reply = new MessageChannel()
	const result = new Promise<SdkReply>((resolve, reject) => {
		reply.port1.onmessage = ({ data }: MessageEvent<SdkReply>) => {
			reply.port1.close()
			if (data.kind === 'failed') {
				const error = new Error(`${data.message}\n${data.stack ?? ''}`)
				reject(error)
			} else resolve(data)
		}
	})
	active.worker.postMessage(operation, [
		reply.port2,
		...(operation.type === 'OPEN' ? [operation.data, operation.control] : [])
	])
	return result
}
const fixture = {
	async windowControl(scope: string, brokerUrl: string) {
		const { createJazzClient } = await import('jazz-tools/client')
		const { createFinanceAccountStore } =
			await import('../../src/lib/runtime/worker/account-store.js')
		const serverUrl = location.origin + '/jazz'
		const store = createFinanceAccountStore({ serverUrl, scope, environment: 'sdk-proof' })
		const session = await createJazzClient({
			serverUrl,
			scope,
			env: 'sdk-proof',
			store,
			initial: 'local-first',
			runtimeSources: { wasmUrl, brokerWorkerUrl: brokerUrl, wasmVersion: 'finance-sdk-proof-1' }
		})
		try {
			const db = session.getSnapshot().client?.db
			if (!db) throw new Error('Window SDK control unavailable')
			await db.upgradeToLocalFirst(() => import('jazz-tools/local-first'))
			return db.isLocalFirst()
		} finally {
			await session.close()
			await store.close()
		}
	},
	async open(scope: string, brokerUrl: string) {
		if (active) throw new Error('SDK fixture already active')
		const data = new MessageChannel(),
			control = new MessageChannel()
		const asset = new URL(brokerUrl)
		if (asset.origin !== location.origin) throw new Error('Foreign SDK broker asset')
		const stats = { opens: 0, reads: 0 }
		const release = serveBrokerHost(data.port1, control.port1, scope, {
			storage: {
				getItem: (key) => {
					stats.reads++
					return localStorage.getItem(key)
				},
				setItem: (key, value) => localStorage.setItem(key, value)
			},
			admitGeneration: (key) => key.startsWith('jazz:shared-worker-generation:jazz-runtime:'),
			admitOpen: (url) => {
				const selected = new URL(url)
				return selected.origin === asset.origin && selected.pathname === asset.pathname
			},
			open: (url, name) => {
				stats.opens++
				return new SharedWorker(url, { type: 'module', name })
			}
		})
		active = {
			worker: new Worker(new URL('./sdk-session.worker.ts', import.meta.url), { type: 'module' }),
			release,
			stats
		}
		return command({ type: 'OPEN', scope, brokerUrl, data: data.port2, control: control.port2 })
	},
	command,
	stats: () => ({ ...active?.stats }),
	async close() {
		const result = await command({ type: 'CLOSE' })
		active?.release()
		active?.worker.terminate()
		active = undefined
		return result
	}
}
declare global {
	interface Window {
		financeSdkFixture: typeof fixture
	}
}
window.financeSdkFixture = fixture
