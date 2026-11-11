import { afterEach, describe, expect, it, vi } from 'vitest'
import { providerRequestMachine, type ProviderRequest } from './provider-request.js'
import { createActor, toPromise, waitFor } from 'xstate'
import type { ActorFromLogic } from 'xstate'

const input: ProviderRequest = {
	endpoint: 'https://finance.example/api/simplefin',
	accessUrl: 'https://user:secret@bridge.simplefin.org/simplefin',
	discovery: false,
	traceId: crypto.randomUUID()
}
const response = {
	errors: [],
	accounts: [
		{
			id: 'checking',
			name: 'Checking',
			currency: 'USD',
			org: { 'sfin-url': 'https://bank.example' }
		}
	]
}
const actors: ActorFromLogic<typeof providerRequestMachine>[] = []
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
	vi.unstubAllGlobals()
})
function start(discovery = false) {
	const actor = createActor(providerRequestMachine, { input: { ...input, discovery } }).start()
	actors.push(actor)
	return actor
}

describe('provider request in a dedicated worker', () => {
	it.each([false, true])('makes one explicit relay request; discovery=%s', async (discovery) => {
		const fetch = vi.fn(async () => Response.json(response))
		vi.stubGlobal('fetch', fetch)
		const actor = start(discovery)
		await expect(toPromise(actor)).resolves.toEqual({ ok: true, response })
		expect(fetch).toHaveBeenCalledOnce()
		expect(fetch.mock.calls[0]).toMatchObject([
			input.endpoint,
			{
				method: 'POST',
				body: JSON.stringify({ operation: discovery ? 'discover' : 'sync', url: input.accessUrl }),
				headers: { 'Content-Type': 'application/json', 'X-Bank-Sync-Trace': input.traceId },
				cache: 'no-store',
				credentials: 'same-origin'
			}
		])
		expect(actor.getSnapshot().context).toMatchObject({
			accessUrl: '',
			payload: undefined,
			response: undefined
		})
	})
	it.each([401, 429, 502])('does not decode or retry HTTP %s', async (status) => {
		const response = new Response(input.accessUrl, { status })
		const json = vi.spyOn(response, 'json')
		const fetch = vi.fn(async () => response)
		vi.stubGlobal('fetch', fetch)
		const actor = start()
		await expect(toPromise(actor)).resolves.toEqual({ ok: false, stage: 'http', status })
		expect(json).not.toHaveBeenCalled()
		expect(fetch).toHaveBeenCalledOnce()
		expect(actor.getSnapshot().context.accessUrl).toBe('')
	})
	it.each([
		{ body: 'invalid JSON', stage: 'decode' },
		{ body: JSON.stringify({ accounts: [{ id: 'incomplete' }] }), stage: 'validation' }
	])('redacts $stage failures', async ({ body, stage }) => {
		const fetch = vi.fn(async () => new Response(body))
		vi.stubGlobal('fetch', fetch)
		const actor = start()
		await expect(toPromise(actor)).resolves.toEqual({ ok: false, stage })
		expect(fetch).toHaveBeenCalledOnce()
		expect(actor.getSnapshot().context).toMatchObject({
			accessUrl: '',
			payload: undefined,
			response: undefined
		})
	})
	it('redacts transport exceptions without retrying', async () => {
		const fetch = vi.fn(async () => {
			throw new Error(input.accessUrl)
		})
		vi.stubGlobal('fetch', fetch)
		await expect(toPromise(start())).resolves.toEqual({ ok: false, stage: 'request' })
		expect(fetch).toHaveBeenCalledOnce()
	})
	it('stopping an active HTTP request aborts its signal', async () => {
		const signals: AbortSignal[] = []
		const pending = Promise.withResolvers<Response>()
		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, options: RequestInit) => {
				if (options.signal) signals.push(options.signal)
				return pending.promise
			})
		)
		const actor = start()
		expect(signals[0]?.aborted).toBe(false)
		actor.stop()
		expect(signals[0]?.aborted).toBe(true)
		pending.resolve(Response.json(response))
		await pending.promise
		expect(actor.getSnapshot().status).toBe('stopped')
	})
	it('keeps body consumption explicit while waiting for the response stream', async () => {
		const body = Promise.withResolvers<Uint8Array>()
		const stream = new ReadableStream({
			async start(controller) {
				controller.enqueue(await body.promise)
				controller.close()
			}
		})
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(stream))
		)
		const actor = start()
		await waitFor(actor, (state) => state.matches('decoding'))
		expect(actor.getSnapshot().context.accessUrl).toBe('')
		body.resolve(new TextEncoder().encode(JSON.stringify(response)))
		await expect(toPromise(actor)).resolves.toEqual({ ok: true, response })
	})
})
