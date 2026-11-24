import { openApplicationClient } from '../../src/lib/runtime/worker/client.js'
import type { RuntimeView } from '../../src/lib/runtime/worker/views.js'

let client: ReturnType<typeof openApplicationClient> | undefined
let view: RuntimeView | undefined
let failed = false
let released = false

const fixture = {
	open(appId: string) {
		client = openApplicationClient({
			appId,
			serverUrl: location.origin + '/jazz',
			publish: (next) => {
				view = next
			},
			recovery: () => {},
			failed: () => {
				failed = true
			},
			createWorker: () => {
				const worker = new Worker(
					new URL('../../src/lib/runtime/worker/application.worker.ts', import.meta.url),
					{ type: 'module' }
				)
				return {
					worker,
					release: () => {
						worker.terminate()
						released = true
					}
				}
			}
		})
	},
	state: () => ({ view, failed, released }),
	add(url: string) {
		const library = view?.library
		if (!client || !library) throw new Error('Native library is unavailable')
		client.post({
			type: 'LIBRARY',
			scope: library.scope,
			requestId: crypto.randomUUID(),
			event: { type: 'ADD', url }
		})
	},
	close: () => client?.close()
}

declare global {
	interface Window {
		clipperHandoverFixture: typeof fixture
	}
}
window.clipperHandoverFixture = fixture
