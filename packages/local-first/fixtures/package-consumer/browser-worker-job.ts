import assert from 'node:assert/strict'
import { createActor, toPromise } from 'xstate'
import {
	createBrowserWorkerJob,
	type BrowserWorkerJobResult
} from 'delightful-local-first/worker/browser-job'

let released = 0
const worker: {
	onmessage: ((event: MessageEvent<unknown>) => void) | null
	onerror: (() => void) | null
	onmessageerror: (() => void) | null
	postMessage: (message: unknown) => void
	terminate: () => void
} = {
	onmessage: null,
	onerror: null,
	onmessageerror: null,
	postMessage: (message) => {
		assert.equal(message, 'selected')
		worker.onmessage?.(new MessageEvent('message', { data: 7 }))
	},
	terminate: () => {
		released++
	}
}
const actor = createActor(createBrowserWorkerJob<string, number>(), {
	input: {
		message: 'selected',
		open: () => worker,
		decode: (value) => {
			if (typeof value !== 'number') throw new Error('Invalid reply')
			return value
		}
	}
}).start()
const result: BrowserWorkerJobResult<number> = await toPromise(actor)
assert.equal(result.kind, 'replied')
if (result.kind === 'replied') assert.equal(result.reply, 7)
assert.equal(released, 1)
assert.equal(worker.onmessage, null)
assert.equal(worker.onerror, null)
assert.equal(worker.onmessageerror, null)
