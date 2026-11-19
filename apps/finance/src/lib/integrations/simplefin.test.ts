import { afterEach, expect, it, vi } from 'vitest'
import {
	bridgeUrl,
	claimToken,
	prepareProviderFetch,
	providerAccountIdentity
} from './simplefin.js'
import type { BankTrace } from './diagnostics.js'

const trace: BankTrace = {
	id: crypto.randomUUID(),
	log: () => {},
	failed: () => {},
	step: async (_stage, work) => await work()
}
const access = 'https://user:secret@bridge.simplefin.org/simplefin'
afterEach(() => {
	vi.unstubAllGlobals()
	vi.resetAllMocks()
})
it.each(['bridge.simplefin.org', 'beta-bridge.simplefin.org'])(
	'accepts official %s endpoints',
	(host) => {
		expect(bridgeUrl(`https://${host}/simplefin/claim/token`, 'claim').hostname).toBe(host)
		expect(bridgeUrl(`https://user:secret@${host}/simplefin`, 'access').hostname).toBe(host)
	}
)
it.each([
	'http://bridge.simplefin.org/simplefin/claim/token',
	'https://bridge.simplefin.org.evil.test/simplefin/claim/token',
	'https://bridge.simplefin.org:8443/simplefin/claim/token',
	'https://bridge.simplefin.org/simplefin/claim/token?redirect=evil',
	'https://bridge.simplefin.org/simplefin/claim/token#fragment',
	'https://user:secret@bridge.simplefin.org/simplefin/claim/token',
	'https://bridge.simplefin.org/simplefin/claim/token/extra'
])('rejects unsafe claim destination %s', (url) => {
	expect(() => bridgeUrl(url, 'claim')).toThrow()
})
it('requires credentials for access URLs', () => {
	expect(() => bridgeUrl('https://bridge.simplefin.org/simplefin', 'access')).toThrow()
})
it('validates tokens before making requests and never retries failed claims', async () => {
	const fetch = vi.fn(async () => new Response('', { status: 502 }))
	vi.stubGlobal('fetch', fetch)
	await expect(claimToken('dummy text', new AbortController().signal, trace)).rejects.toThrow()
	expect(fetch).not.toHaveBeenCalled()
	await expect(
		claimToken(
			btoa('https://bridge.simplefin.org/simplefin/claim/token'),
			new AbortController().signal,
			trace
		)
	).rejects.toThrow('provider-failure')
	expect(fetch).toHaveBeenCalledTimes(1)
})
it('claims only, then selects worker fetching without issuing another claim', async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(access))
		.mockImplementation(async () => Response.json({ errors: [], accounts: [] }))
	vi.stubGlobal('fetch', fetch)
	const signal = new AbortController().signal
	expect(
		await claimToken(btoa('https://bridge.simplefin.org/simplefin/claim/token'), signal, trace)
	).toBe(access)
	expect(fetch).toHaveBeenCalledTimes(1)
	expect(await prepareProviderFetch(access, true, signal, trace)).toEqual({ kind: 'worker' })
	expect(await prepareProviderFetch(access, false, signal, trace)).toEqual({ kind: 'worker' })
	const operations = fetch.mock.calls.map((call) => {
		const options: unknown = call[1]
		return options && typeof options === 'object' && 'body' in options ? options.body : undefined
	})
	expect(operations).toEqual([
		JSON.stringify({
			operation: 'claim',
			url: 'https://bridge.simplefin.org/simplefin/claim/token'
		})
	])
})
it('rejects unsafe credentials before starting a worker', async () => {
	await expect(
		prepareProviderFetch(
			'https://evil.example/simplefin',
			false,
			new AbortController().signal,
			trace
		)
	).rejects.toThrow('invalid-provider-url')
})
it('refuses already-cancelled fetch preparation', async () => {
	const controller = new AbortController()
	controller.abort()
	await expect(prepareProviderFetch(access, false, controller.signal, trace)).rejects.toMatchObject(
		{
			name: 'AbortError'
		}
	)
})
it('separates account identities across institutions while ignoring renamed accounts', () => {
	const account = {
		id: 'same',
		name: 'Checking',
		currency: 'USD',
		org: { 'sfin-url': 'https://bank.example', domain: 'bank.example' }
	}
	expect(providerAccountIdentity(account)).toBe(
		providerAccountIdentity({ ...account, name: 'Renamed' })
	)
	expect(providerAccountIdentity(account)).not.toBe(
		providerAccountIdentity({ ...account, org: { ...account.org, domain: 'other.example' } })
	)
})
