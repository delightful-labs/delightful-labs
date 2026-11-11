import { afterEach, expect, it, vi } from 'vitest'
import { requestRelay, type RelayRequest } from './simplefin-relay.js'

afterEach(() => vi.unstubAllGlobals())
it.each(['claim', 'discover', 'sync'] satisfies RelayRequest['operation'][])(
	'uses the shared no-store POST contract for %s without interpreting the response',
	async (operation) => {
		const response = new Response('caller-owned body', { status: 502 })
		const fetch = vi.fn(async () => response)
		vi.stubGlobal('fetch', fetch)
		const signal = new AbortController().signal
		const body = { operation, url: 'https://synthetic.invalid' }
		await expect(requestRelay('/api/simplefin', body, signal, 'trace')).resolves.toBe(response)
		expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/simplefin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bank-Sync-Trace': 'trace' },
			body: JSON.stringify(body),
			signal,
			cache: 'no-store',
			credentials: 'same-origin'
		})
		expect(response.bodyUsed).toBe(false)
	}
)
it('starts no HTTP request when already cancelled', () => {
	const fetch = vi.fn()
	vi.stubGlobal('fetch', fetch)
	const controller = new AbortController()
	controller.abort()
	expect(() =>
		requestRelay(
			'/api/simplefin',
			{ operation: 'sync', url: 'https://synthetic.invalid' },
			controller.signal,
			'trace'
		)
	).toThrow()
	expect(fetch).not.toHaveBeenCalled()
})
it('does not retry transport failures', async () => {
	const fetch = vi.fn(async () => {
		throw new TypeError('offline')
	})
	vi.stubGlobal('fetch', fetch)
	await expect(
		requestRelay(
			'/api/simplefin',
			{ operation: 'claim', url: 'https://synthetic.invalid' },
			new AbortController().signal,
			'trace'
		)
	).rejects.toThrow('offline')
	expect(fetch).toHaveBeenCalledOnce()
})
