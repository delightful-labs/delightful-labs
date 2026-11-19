import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankTrace } from './diagnostics.js'
import { requestProviderWorker } from './simplefin-worker.js'
import type { ProviderReply, ProviderRequest } from '#lib/machines/bank-sync/provider-request.js'

const workers: ControlledWorker[] = []
class ControlledWorker {
	static failPosting = false
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null
	onerror: ((event: Pick<ErrorEvent, 'preventDefault'>) => void) | null = null
	onmessageerror: (() => void) | null = null
	postMessage = vi.fn<(input: ProviderRequest) => void>()
	terminate = vi.fn()
	constructor() {
		workers.push(this)
		if (ControlledWorker.failPosting)
			this.postMessage.mockImplementation(() => {
				throw new Error('post failed')
			})
	}
	reply(reply: unknown) {
		this.onmessage?.(new MessageEvent('message', { data: reply }))
	}
}
const accessUrl = 'https://user:secret@bridge.simplefin.org/simplefin'
const response = { errors: [], accounts: [] }
function start(signal = new AbortController().signal) {
	const trace = {
		id: crypto.randomUUID(),
		log: vi.fn(),
		failed: vi.fn(),
		step: async (_stage, effect) => effect()
	} satisfies BankTrace
	const result = requestProviderWorker(accessUrl, false, signal, trace)
	const worker = workers.at(-1)
	if (!worker) throw new Error('Expected provider worker')
	return { worker, result, trace }
}
function expectDisposed(worker: ControlledWorker) {
	expect(worker.terminate).toHaveBeenCalledOnce()
	expect(worker.onmessage).toBeNull()
	expect(worker.onerror).toBeNull()
	expect(worker.onmessageerror).toBeNull()
}
beforeEach(() => {
	ControlledWorker.failPosting = false
	vi.stubGlobal('Worker', ControlledWorker)
	vi.stubGlobal('location', { origin: 'https://finance.example' })
})
afterEach(() => {
	workers.splice(0)
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('provider worker resource boundary', () => {
	it('sends one transient request and terminates on success', async () => {
		const { worker, result, trace } = start()
		expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
			endpoint: 'https://finance.example/api/simplefin',
			accessUrl,
			discovery: false,
			traceId: trace.id
		})
		worker.reply({ ok: true, response })
		await expect(result).resolves.toEqual(response)
		expectDisposed(worker)
		expect(JSON.stringify(trace.log.mock.calls)).not.toContain(accessUrl)
	})
	it.each(['request', 'http', 'decode', 'validation'] satisfies Extract<
		ProviderReply,
		{ ok: false }
	>['stage'][])('terminates on a sanitized %s failure without retrying', async (stage) => {
		const { worker, result } = start()
		worker.reply({ ok: false, stage, status: 502 })
		await expect(result).rejects.toThrow('provider-failure')
		expectDisposed(worker)
		expect(workers).toHaveLength(1)
	})
	it.each(['error', 'messageerror'])('cleans up a native %s event', async (kind) => {
		const { worker, result } = start()
		const preventDefault = vi.fn()
		if (kind === 'error')
			worker.onerror?.({ preventDefault } satisfies Pick<ErrorEvent, 'preventDefault'>)
		else worker.onmessageerror?.()
		await expect(result).rejects.toThrow('provider-failure')
		expectDisposed(worker)
		expect(workers).toHaveLength(1)
	})
	it('cleans up when posting the request fails', async () => {
		ControlledWorker.failPosting = true
		const { worker, result } = start()
		await expect(result).rejects.toThrow('provider-failure')
		expectDisposed(worker)
		expect(worker.postMessage).toHaveBeenCalledOnce()
	})
	it('rejects worker bootstrap errors without starting another worker', async () => {
		const constructor = vi.fn(function () {
			throw new Error('worker bootstrap failed')
		})
		vi.stubGlobal('Worker', constructor)
		await expect(
			requestProviderWorker(accessUrl, false, new AbortController().signal, {
				id: 'test',
				log: vi.fn(),
				failed: vi.fn(),
				step: async (_stage, effect) => effect()
			})
		).rejects.toThrow('worker bootstrap failed')
		expect(constructor).toHaveBeenCalledOnce()
	})
	it.each([
		undefined,
		null,
		{},
		{ ok: 'yes' },
		{ ok: true },
		{ ok: true, response: { accounts: [], errors: 'private error' } },
		{ ok: true, response: { accounts: [null], errors: [] } },
		{ ok: false, stage: accessUrl },
		{ ok: false, stage: 'http', status: accessUrl }
	])('rejects malformed worker replies and always settles: %j', async (reply) => {
		const controller = new AbortController()
		const { worker, result, trace } = start(controller.signal)
		worker.reply(reply)
		await expect(result).rejects.toThrow('provider-failure')
		controller.abort()
		expectDisposed(worker)
		expect(JSON.stringify(trace.log.mock.calls)).not.toContain(accessUrl)
	})
	it('rejects unexpected exceptions from the native message callback', async () => {
		const { worker, result } = start()
		worker.reply({
			get ok() {
				throw new Error('unexpected reply accessor')
			}
		})
		await expect(result).rejects.toThrow('provider-failure')
		expectDisposed(worker)
	})
	it('settles and terminates once when native callbacks arrive late', async () => {
		const { worker, result } = start()
		const message = worker.onmessage,
			failure = worker.onmessageerror
		worker.reply({ ok: true, response })
		message?.(new MessageEvent('message', { data: undefined }))
		failure?.()
		await expect(result).resolves.toEqual(response)
		expectDisposed(worker)
	})
	it('terminates on cancellation and ignores subsequent replies', async () => {
		const controller = new AbortController()
		const { worker, result } = start(controller.signal)
		controller.abort()
		await expect(result).rejects.toMatchObject({ name: 'AbortError' })
		worker.reply({ ok: true, response })
		expectDisposed(worker)
		expect(workers).toHaveLength(1)
	})
	it('terminates on the overall deadline including a stalled bootstrap/body', async () => {
		const deadline = new AbortController()
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
		const { worker, result, trace } = start()
		const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
		deadline.abort(new DOMException('Timed out', 'TimeoutError'))
		await rejected
		expect(timeout).toHaveBeenCalledWith(75000)
		expect(trace.log).toHaveBeenCalledWith('provider.worker.timeout')
		expectDisposed(worker)
		expect(workers).toHaveLength(1)
	})
})
