import { vi } from 'vitest'
import type { BrowserJobWorker } from '../../src/lib/machines/lifecycle/browser-worker-job.js'

export class TestJobWorker implements BrowserJobWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null
	onerror: ((event?: Event) => void) | null = null
	onmessageerror: ((event?: Event) => void) | null = null
	postMessage = vi.fn(
		(_message: unknown, _transfer?: Transferable[] | StructuredSerializeOptions) => {}
	)
	terminate = vi.fn(() => {})
	reply(value: unknown) {
		this.onmessage?.(new MessageEvent('message', { data: value }))
	}
}
