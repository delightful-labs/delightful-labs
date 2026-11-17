import { afterEach, expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import { pdsRead } from './pds-read.js'
import type { PdsReadSession } from './pds-read.js'
import { pdsReadResultSchema } from './pds-record.js'

const did = 'did:web:owner.example'
const uri = `at://${did}/at.margin.note/3jzfcijpj2z2a`
const record = {
	uri,
	value: {
		$type: 'at.margin.note',
		target: { source: 'https://example.org', future: [true, null] },
		future: { content: 'Unfamiliar metadata' }
	}
}
afterEach(() => vi.restoreAllMocks())

function start(
	handle: PdsReadSession['handle'],
	changes: { uri?: string; did?: string; isCurrent?: () => boolean } = {},
	clock = new SimulatedClock()
) {
	const session = { did: changes.did ?? did, handle }
	const actor = createActor(pdsRead, {
		input: { uri: changes.uri ?? uri, session, isCurrent: changes.isCurrent ?? (() => true) },
		clock
	})
	const result = toPromise(actor)
	actor.start()
	return { actor, result, clock }
}
function stalledBody() {
	const cancelled = vi.fn()
	const entered = Promise.withResolvers<void>()
	const body = new ReadableStream<Uint8Array>({
		pull() {
			entered.resolve()
		},
		cancel: cancelled
	})
	return {
		response: new Response(body, { headers: { 'Content-Type': 'application/json' } }),
		cancelled,
		entered: entered.promise
	}
}

it('returns the explicit found shape and makes only a bound GET through the supplied SDK session', async () => {
	const handle = vi.fn<PdsReadSession['handle']>(async () => Response.json(record))
	const run = start(handle)
	try {
		expect(await run.result).toEqual({ status: 'found', record })
		expect(pdsReadResultSchema.safeParse(await run.result).success).toBe(true)
		expect(handle).toHaveBeenCalledTimes(1)
		const [pathname, init] = handle.mock.calls[0] ?? []
		const url = new URL(pathname ?? '', 'https://pds.example.invalid')
		expect(url.pathname).toBe('/xrpc/com.atproto.repo.getRecord')
		expect(Object.fromEntries(url.searchParams)).toEqual({
			repo: did,
			collection: 'at.margin.note',
			rkey: '3jzfcijpj2z2a'
		})
		expect(init?.method).toBe('GET')
		expect(init?.cache).toBe('no-store')
		expect(init?.redirect).toBe('error')
		expect(init?.body).toBeUndefined()
	} finally {
		run.actor.stop()
	}
})

for (const status of [400, 404])
	it(`returns notFound only for an explicit named ${status} response`, async () => {
		const run = start(async () =>
			Response.json(
				{ error: 'RecordNotFound', message: 'Unavailable, including possible takedown' },
				{ status }
			)
		)
		try {
			expect(await run.result).toEqual({ status: 'notFound', uri })
		} finally {
			run.actor.stop()
		}
	})

it('does not turn malformed, generic HTTP, authentication or server failures into notFound', async () => {
	for (const response of [
		Response.json({ error: 'NotFound' }, { status: 404 }),
		Response.json({ error: 'RecordNotFound' }, { status: 500 }),
		Response.json({ error: 'RecordNotFound' }, { status: 401 }),
		Response.json({ error: 'RecordNotFound' }, { status: 403 }),
		Response.json({ error: 'RecordNotFound' }, { status: 200 }),
		new Response('RecordNotFound', { status: 404 }),
		new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
		Response.json({ ...record, uri: uri.replace('owner.example', 'other.example') }),
		new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
		new Response(null, { status: 204 })
	]) {
		const run = start(async () => response)
		try {
			await expect(run.result).rejects.toThrow('PDS record read failed')
		} finally {
			run.actor.stop()
		}
	}
	const run = start(async () => {
		throw new Error('Private provider failure')
	})
	try {
		await expect(run.result).rejects.toThrow('PDS record read failed')
	} finally {
		run.actor.stop()
	}
})

it('refuses invalid addresses, wrong SDK identities and stale scope before issuing a request', async () => {
	const handle = vi.fn<PdsReadSession['handle']>(async () => Response.json(record))
	for (const changes of [
		{ uri: 'invalid' },
		{ uri: uri + '\n' },
		{ did: 'did:web:other.example' },
		{ isCurrent: () => false }
	]) {
		const run = start(handle, changes)
		try {
			await expect(run.result).rejects.toThrow('PDS record read failed')
		} finally {
			run.actor.stop()
		}
	}
	expect(handle).not.toHaveBeenCalled()
})

it('discards an otherwise valid result after scope replacement', async () => {
	let current = true
	const gate = Promise.withResolvers<Response>(),
		entered = Promise.withResolvers<void>()
	const run = start(
		() => {
			entered.resolve()
			return gate.promise
		},
		{ isCurrent: () => current }
	)
	try {
		await entered.promise
		current = false
		gate.resolve(Response.json(record))
		await expect(run.result).rejects.toThrow('PDS record read failed')
	} finally {
		run.actor.stop()
	}
})

it('cancels a pending body read and releases its native reader', async () => {
	const body = stalledBody()
	const run = start(async () => body.response)
	const rejected = expect(run.result).rejects.toMatchObject({ name: 'AbortError' })
	try {
		await body.entered
		// Wait for acquisition of the native reader rather than a stream prefetch.
		await vi.waitFor(() => expect(body.response.body?.locked).toBe(true))
		run.actor.send({ type: 'CANCEL' })
		await rejected
		await vi.waitFor(() => expect(body.response.body?.locked).toBe(false))
		expect(body.cancelled).toHaveBeenCalledTimes(1)
	} finally {
		run.actor.stop()
	}
})

it('bounds a stalled body with the owned deadline and aborts the native request signal', async () => {
	const body = stalledBody()
	let signal: AbortSignal | null | undefined
	const run = start(async (_pathname, init) => {
		signal = init?.signal
		return body.response
	})
	const rejected = expect(run.result).rejects.toMatchObject({ name: 'TimeoutError' })
	try {
		await vi.waitFor(() => expect(body.response.body?.locked).toBe(true))
		run.clock.increment(30_000)
		await rejected
		expect(signal?.aborted).toBe(true)
		await vi.waitFor(() => expect(body.response.body?.locked).toBe(false))
		expect(body.cancelled).toHaveBeenCalledTimes(1)
	} finally {
		run.actor.stop()
	}
})

it('releases an SDK response that arrives after cancellation, without admitting a late result', async () => {
	const gate = Promise.withResolvers<Response>(),
		entered = Promise.withResolvers<void>()
	const run = start(() => {
		entered.resolve()
		return gate.promise
	})
	const rejected = expect(run.result).rejects.toMatchObject({ name: 'AbortError' })
	await entered.promise
	run.actor.send({ type: 'CANCEL' })
	await rejected
	const body = stalledBody()
	gate.resolve(body.response)
	await vi.waitFor(() => expect(body.cancelled).toHaveBeenCalledTimes(1))
	expect(body.response.body?.locked).toBe(false)
	expect(run.actor.getSnapshot().output).toBeUndefined()
	run.actor.stop()
})

it('releases response bodies on external stop and on unsupported/oversized payloads', async () => {
	const body = stalledBody()
	const run = start(async () => body.response)
	await vi.waitFor(() => expect(body.response.body?.locked).toBe(true))
	run.actor.stop()
	await vi.waitFor(() => expect(body.response.body?.locked).toBe(false))
	expect(body.cancelled).toHaveBeenCalledTimes(1)
	for (const contentType of ['text/html', 'application/json']) {
		const cancelled = vi.fn()
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(1_048_577))
				},
				cancel: cancelled
			}),
			{ headers: { 'Content-Type': contentType } }
		)
		const attempt = start(async () => response)
		try {
			await expect(attempt.result).rejects.toThrow('PDS record read failed')
			expect(response.body?.locked).toBe(false)
			expect(cancelled).toHaveBeenCalledTimes(1)
		} finally {
			attempt.actor.stop()
		}
	}
})

it('rejects completion beyond the wall-clock deadline even before a delayed timer is delivered', async () => {
	let now = 1_000
	vi.spyOn(Date, 'now').mockImplementation(() => now)
	const run = start(async () => {
		now = 31_001
		return Response.json(record)
	})
	try {
		await expect(run.result).rejects.toMatchObject({ name: 'TimeoutError' })
	} finally {
		run.actor.stop()
	}
})

it('keeps the approved result alternatives exclusive and refuses nullable outcomes', () => {
	for (const value of [
		null,
		{ status: 'found', uri },
		{ status: 'notFound', uri, record },
		{ status: 'failed' }
	])
		expect(pdsReadResultSchema.safeParse(value).success).toBe(false)
})
