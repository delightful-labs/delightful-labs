import { afterEach, expect, it, vi } from 'vitest'
import { openApplicationClient, type WorkerReply } from '../../web/src/lib/runtime/worker/client.js'
import { accountWorker } from './account-client.js'

afterEach(() => vi.unstubAllGlobals())

function fixture(onClosed = vi.fn()) {
	let receive: Worker['onmessage'] = null
	let fail: Worker['onerror'] = null
	const postMessage = vi.fn<Worker['postMessage']>()
	const terminate = vi.fn()
	vi.stubGlobal('Worker', function () {
		return {
			postMessage,
			terminate,
			get onmessage() {
				return receive
			},
			set onmessage(value: Worker['onmessage']) {
				receive = value
			},
			get onerror() {
				return fail
			},
			set onerror(value: Worker['onerror']) {
				fail = value
			}
		}
	})
	vi.stubGlobal(
		'window',
		Object.assign(new EventTarget(), {
			location: { href: 'chrome-extension://clipper/signin.html', search: '' }
		})
	)
	vi.stubGlobal('location', window.location)
	vi.stubGlobal('navigator', { onLine: true })
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
	const worker = new Worker('test-only-worker')
	const adapter = accountWorker(worker, () => {}, onClosed)
	const failed = vi.fn()
	const client = openApplicationClient({
		appId: crypto.randomUUID(),
		serverUrl: 'https://example.invalid',
		createWorker: () => adapter,
		publish: () => {},
		recovery: () => {},
		failed
	})
	const emit = (data: WorkerReply) => receive?.call(worker, new MessageEvent('message', { data }))
	const error = () =>
		fail?.call(
			worker,
			Object.assign(new Event('error'), {
				message: 'test worker failure',
				filename: '',
				lineno: 0,
				colno: 0,
				error: undefined
			})
		)
	return { client, emit, error, failed, terminate, onClosed }
}

it('closes sign-in after the primary shutdown receipt releases the worker, without a second-channel message', () => {
	const onClosed = vi.fn()
	const { client, emit, terminate } = fixture(onClosed)
	client.close()
	expect(onClosed).not.toHaveBeenCalled()
	expect(terminate).not.toHaveBeenCalled()
	emit({ type: 'CLOSED' })
	expect(terminate).toHaveBeenCalledOnce()
	expect(onClosed).toHaveBeenCalledOnce()
	const released = terminate.mock.invocationCallOrder[0]
	const closed = onClosed.mock.invocationCallOrder[0]
	if (released === undefined || closed === undefined) throw new Error('Missing close order')
	expect(released).toBeLessThan(closed)
})

it('does not close or release a failed worker before its native cleanup acknowledgement', () => {
	const { error, failed, emit, terminate, onClosed } = fixture()
	error()
	expect(failed).toHaveBeenCalledOnce()
	expect(terminate).not.toHaveBeenCalled()
	expect(onClosed).not.toHaveBeenCalled()
	emit({ type: 'CLOSED' })
	expect(terminate).toHaveBeenCalledOnce()
	expect(onClosed).toHaveBeenCalledOnce()
})

it('accepts a worker-initiated clean shutdown without a preceding UI close request', () => {
	const { emit, terminate, onClosed } = fixture()
	expect(onClosed).not.toHaveBeenCalled()
	emit({ type: 'CLOSED' })
	expect(terminate).toHaveBeenCalledOnce()
	expect(onClosed).toHaveBeenCalledOnce()
})
