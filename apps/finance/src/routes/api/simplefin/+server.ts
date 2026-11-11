import { createBankTrace } from '#lib/integrations/diagnostics.js'
import { z } from 'zod'
import { bridgeUrl, simplefinDemo } from '#lib/integrations/simplefin.js'
import type { RequestHandler } from './$types'

const requestSchema = z.strictObject({
	operation: z.enum(['claim', 'discover', 'sync']),
	url: z.string().max(8192)
})
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

// The relay never stores secrets or writes Jazz data. Do not log request bodies or upstream errors.
export const POST: RequestHandler = async ({ request, url }) => {
	const incomingTrace = z.uuid().safeParse(request.headers.get('X-Bank-Sync-Trace'))
	const trace = incomingTrace.success
		? createBankTrace('relay', incomingTrace.data)
		: createBankTrace('relay')
	trace.log('request.received')
	if (
		request.headers.get('origin') !== url.origin ||
		!request.headers.get('content-type')?.startsWith('application/json')
	) {
		trace.log('request.rejected', { status: 403 })
		return Response.json({ error: 'forbidden' }, { status: 403, headers })
	}
	if (simplefinDemo) {
		trace.log('request.demo-blocked', { status: 503 })
		return Response.json({ error: 'provider-disabled' }, { status: 503, headers })
	}
	try {
		const body = await request.text()
		if (body.length > 10000)
			return Response.json({ error: 'invalid-request' }, { status: 413, headers })
		const input = await trace.step('request.validate', () => requestSchema.parse(JSON.parse(body)))
		trace.log(`operation.${input.operation}`)
		const target = await trace.step('destination.validate', () =>
			bridgeUrl(input.url, input.operation === 'claim' ? 'claim' : 'access', trace)
		)
		const authorization =
			input.operation === 'claim'
				? undefined
				: `Basic ${btoa(`${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}`)}`
		target.username = ''
		target.password = ''
		if (input.operation !== 'claim') {
			target.pathname += '/accounts'
			if (input.operation === 'discover') target.searchParams.set('balances-only', '1')
			else {
				target.searchParams.set('start-date', String(Math.floor(Date.now() / 1000) - 90 * 86400))
				target.searchParams.set('end-date', String(Math.floor(Date.now() / 1000)))
			}
		}
		const upstream = await trace.step('upstream.http', () =>
			fetch(target, {
				method: input.operation === 'claim' ? 'POST' : 'GET',
				headers: authorization ? { Authorization: authorization } : {},
				// Inspect redirects as rejected HTTP responses; never follow them.
				redirect: 'manual',
				cache: 'no-store',
				signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)])
			})
		)
		trace.log('upstream.response', { status: upstream.status })
		if (!upstream.ok) return Response.json({ error: 'provider-failure' }, { status: 502, headers })
		return new Response(upstream.body, {
			headers: {
				...headers,
				'Content-Type': input.operation === 'claim' ? 'text/plain' : 'application/json'
			}
		})
	} catch (error) {
		trace.failed('request.failed', error)
		return Response.json({ error: 'provider-failure' }, { status: 502, headers })
	}
}
