import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankTrace } from '#lib/integrations/diagnostics.js'
import { providerFetchMachine } from '#lib/machines/bank-sync/provider-fetch.js'
import { connection } from '#lib/machines/bank-sync/test-fixtures.js'
import { createActor, toPromise, waitFor } from 'xstate'
import type { ProviderReply, ProviderRequest } from '#lib/machines/bank-sync/provider-request.js'

const workers: ControlledWorker[] = []
const cleanups: (() => void)[] = []
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
async function start() {
	const trace = {
		id: crypto.randomUUID(),
		log: vi.fn(),
		failed: vi.fn(),
		step: async (_stage, effect) => effect()
	} satisfies BankTrace
	const actor = createActor(providerFetchMachine, {
		input: {
			accessUrl,
			work: {
				command: { type: 'SYNC' },
				current: connection,
				scope: {
					ownerId: connection.ownerId ?? 'owner',
					organizationId: connection.organizationId,
					connectionId: connection.id
				},
				trace,
				attemptAt: new Date()
			}
		}
	}).start()
	cleanups.push(() => actor.stop())
	const result = toPromise(actor)
	await waitFor(actor, (state) => state.matches('requesting') || state.status === 'done')
	const worker = workers.at(-1)
	if (!worker) throw new Error('Expected provider worker')
	return { worker, result, trace, actor }
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
	for (const cleanup of cleanups.splice(0)) cleanup()
	workers.splice(0)
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('provider worker resource boundary', () => {
	it('sends one transient request and terminates on success', async () => {
		const { worker, result, trace, actor } = await start()
		expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(
			{
				endpoint: 'https://finance.example/api/simplefin',
				accessUrl,
				discovery: false,
				traceId: trace.id
			},
			[]
		)
		worker.reply({ ok: true, response })
		await expect(result).resolves.toEqual({ kind: 'replied', response })
		expectDisposed(worker)
		expect(actor.getSnapshot().context.input).toBeUndefined()
		expect(JSON.stringify(trace.log.mock.calls)).not.toContain(accessUrl)
	})
	it.each(['request', 'http', 'decode', 'validation'] satisfies Extract<
		ProviderReply,
		{ ok: false }
	>['stage'][])('terminates on a sanitized %s failure without retrying', async (stage) => {
		const { worker, result } = await start()
		worker.reply({ ok: false, stage, status: 502 })
		await expect(result).resolves.toEqual({ kind: 'failed', reason: 'provider' })
		expectDisposed(worker)
		expect(workers).toHaveLength(1)
	})
	it.each(['error', 'messageerror'])('cleans up a native %s event', async (kind) => {
		const { worker, result } = await start()
		const preventDefault = vi.fn()
		if (kind === 'error')
			worker.onerror?.({ preventDefault } satisfies Pick<ErrorEvent, 'preventDefault'>)
		else worker.onmessageerror?.()
		if (kind === 'error') expect(preventDefault).toHaveBeenCalledOnce()
		await expect(result).resolves.toEqual({ kind: 'failed', reason: 'provider' })
		expectDisposed(worker)
		expect(workers).toHaveLength(1)
	})
	it('cleans up when posting the request fails', async () => {
		ControlledWorker.failPosting = true
		const { worker, result } = await start()
		await expect(result).resolves.toEqual({ kind: 'failed', reason: 'provider' })
		expectDisposed(worker)
		expect(worker.postMessage).toHaveBeenCalledOnce()
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
		const { worker, result, trace } = await start()
		worker.reply(reply)
		await expect(result).resolves.toEqual({ kind: 'failed', reason: 'provider' })
		expectDisposed(worker)
		expect(JSON.stringify(trace.log.mock.calls)).not.toContain(accessUrl)
	})
	it('rejects unexpected exceptions from the native message callback', async () => {
		const { worker, result } = await start()
		worker.reply({
			get ok() {
				throw new Error('unexpected reply accessor')
			}
		})
		await expect(result).resolves.toEqual({ kind: 'failed', reason: 'provider' })
		expectDisposed(worker)
	})
	it('settles and terminates once when native callbacks arrive late', async () => {
		const { worker, result } = await start()
		const message = worker.onmessage,
			failure = worker.onmessageerror
		worker.reply({ ok: true, response })
		message?.(new MessageEvent('message', { data: undefined }))
		failure?.()
		await expect(result).resolves.toEqual({ kind: 'replied', response })
		expectDisposed(worker)
	})
	it('terminates on cancellation and ignores subsequent replies', async () => {
		const { worker, result, actor } = await start()
		actor.send({ type: 'CANCEL' })
		await expect(result).resolves.toEqual({ kind: 'cancelled' })
		worker.reply({ ok: true, response })
		expectDisposed(worker)
		expect(workers).toHaveLength(1)
	})
	it('terminates on the overall deadline including a stalled bootstrap/body', async () => {
		vi.useFakeTimers()
		const { worker, result, trace } = await start()
		await vi.advanceTimersByTimeAsync(75000)
		await expect(result).resolves.toEqual({ kind: 'failed', reason: 'timeout' })
		expect(trace.log).toHaveBeenCalledWith('provider.worker.timeout')
		expectDisposed(worker)
		expect(workers).toHaveLength(1)
	})
	it('retains ownership when native release fails', async () => {
		const { worker, actor } = await start()
		worker.terminate.mockImplementation(() => {
			throw new Error('release-refused')
		})
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		expect(actor.getSnapshot().output).toBeUndefined()
		expect(worker.terminate).toHaveBeenCalledOnce()
	})
})
