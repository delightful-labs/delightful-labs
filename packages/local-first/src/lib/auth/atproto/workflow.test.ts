import { afterEach, expect, it, vi } from 'vitest'
import { createActor, setup, types, waitFor, type ActorRefFrom } from 'xstate'
import { createAtprotoWorkflow } from './workflow.js'

const working = { key: 'working' }
const failed = { key: 'failed' }
const { machine, selectView } = createAtprotoWorkflow({ messages: { working, failed } })
function fixture(callbackAttempt?: string) {
	const redirect = vi.fn(),
		returned = vi.fn()
	const host = setup({
		schemas: {
			events: { OAUTH_REDIRECT: types<{ url: string }>(), OAUTH_RETURNED: types<{}>() },
			children: { provider: types<ActorRefFrom<typeof machine>>() }
		},
		actors: { provider: machine }
	}).createMachine({
		invoke: { id: 'provider', src: 'provider', input: { callbackAttempt } },
		on: {
			OAUTH_REDIRECT: ({ event }, enq) => enq(() => redirect(event.url)),
			OAUTH_RETURNED: (_args, enq) => enq(returned)
		}
	})
	const owner = createActor(host).start()
	const provider = owner.getSnapshot().children.provider
	if (!provider) throw new Error('Provider child unavailable')
	return { owner, provider, redirect, returned }
}
afterEach(() => vi.unstubAllGlobals())

it('waits for confirmation before issuing identity or provider work and retains the admitted handle', async () => {
	const issue = vi.spyOn(crypto, 'randomUUID')
	const fetch = vi.fn(async (_path: string, _init: RequestInit) =>
		Response.json({ url: 'https://provider.invalid/authorize' })
	)
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	try {
		f.provider.send({ type: 'BEGIN', handle: 'first.example', requiresConfirmation: true })
		expect(selectView(f.provider.getSnapshot()).confirmationRequired).toBe(true)
		expect(issue).not.toHaveBeenCalled()
		expect(fetch).not.toHaveBeenCalled()
		f.provider.send({ type: 'BEGIN', handle: 'other.example' })
		f.provider.send({ type: 'CONFIRM' })
		await waitFor(f.provider, (snapshot) => snapshot.matches('redirecting'))
		const call = fetch.mock.calls[0]
		if (!call || typeof call[1].body !== 'string') throw new Error('Expected authorization request')
		expect(JSON.parse(call[1].body)).toMatchObject({ handle: 'first.example', scope: 'atproto' })
		expect(issue).toHaveBeenCalledOnce()
	} finally {
		f.owner.stop()
		issue.mockRestore()
	}
})

it('cancels confirmation without contacting the provider', () => {
	const fetch = vi.fn()
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	try {
		f.provider.send({ type: 'BEGIN', handle: 'person.example', requiresConfirmation: true })
		f.provider.send({ type: 'CANCEL' })
		f.provider.send({ type: 'CONFIRM' })
		expect(f.provider.getSnapshot().matches('idle')).toBe(true)
		expect(fetch).not.toHaveBeenCalled()
		expect(f.redirect).not.toHaveBeenCalled()
	} finally {
		f.owner.stop()
	}
})

it('aborts canceled authorization and ignores its late result', async () => {
	const response = Promise.withResolvers<Response>()
	let signal: AbortSignal | null | undefined
	vi.stubGlobal(
		'fetch',
		vi.fn((_path: string, input: RequestInit) => {
			signal = input.signal
			return response.promise
		})
	)
	const f = fixture()
	try {
		f.provider.send({ type: 'BEGIN', handle: 'person.example' })
		await waitFor(f.provider, (snapshot) => snapshot.matches('authorizing'))
		f.provider.send({ type: 'CANCEL' })
		expect(signal?.aborted).toBe(true)
		response.resolve(Response.json({ url: 'https://provider.invalid/authorize' }))
		await vi.waitFor(() => expect(f.provider.getSnapshot().matches('idle')).toBe(true))
		expect(f.redirect).not.toHaveBeenCalled()
	} finally {
		f.owner.stop()
	}
})

it('requests only identity access by default and trims a supplied handle', async () => {
	const fetch = vi.fn(async (_path: string, _init: RequestInit) =>
		Response.json({ url: 'https://provider.invalid/authorize' })
	)
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	try {
		expect(fetch).not.toHaveBeenCalled()
		f.provider.send({ type: 'BEGIN', handle: '  person.example  ' })
		await waitFor(f.provider, (snapshot) => snapshot.matches('redirecting'))
		const call = fetch.mock.calls[0]
		if (!call || typeof call[1].body !== 'string') throw new Error('Expected authorization request')
		expect(JSON.parse(call[1].body)).toMatchObject({ handle: 'person.example', scope: 'atproto' })
		expect(f.redirect).toHaveBeenCalledExactlyOnceWith('https://provider.invalid/authorize')
		expect(selectView(f.provider.getSnapshot()).message).toBe(working)
	} finally {
		f.owner.stop()
	}
})

it('rejects empty input before issuing requests and exposes consumer failure descriptors', async () => {
	const fetch = vi.fn(async () => new Response(null, { status: 503 }))
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	try {
		f.provider.send({ type: 'BEGIN', handle: '   ' })
		expect(fetch).not.toHaveBeenCalled()
		f.provider.send({ type: 'BEGIN', handle: 'person.example' })
		await waitFor(f.provider, (snapshot) => snapshot.matches('failed'))
		expect(selectView(f.provider.getSnapshot())).toMatchObject({ busy: false, message: failed })
		expect(f.redirect).not.toHaveBeenCalled()
	} finally {
		f.owner.stop()
	}
})

it('does not confirm a callback receipt for another attempt', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ attemptId: crypto.randomUUID(), userId: 'user' }))
	)
	const f = fixture(crypto.randomUUID())
	try {
		await waitFor(f.provider, (snapshot) => snapshot.matches('completionUncertain'))
		expect(f.returned).not.toHaveBeenCalled()
		expect(selectView(f.provider.getSnapshot()).confirmation).toBe('uncertain')
	} finally {
		f.owner.stop()
	}
})
