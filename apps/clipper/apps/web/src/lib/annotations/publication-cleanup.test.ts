import { afterEach, expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, waitFor } from 'xstate'
import { bindWorkerConnectivity } from '../offline/connectivity.js'
import { publicationBaseSchema } from './publication.js'
import { publicationCleanupMachine } from './publication-cleanup.js'
import type { Publication } from './publication.js'

function fixture() {
	const connectivity = bindWorkerConnectivity(true)
	const publication: Publication = {
		libraryId: crypto.randomUUID(),
		source: { noteId: crypto.randomUUID() },
		publishingDid: 'did:web:owner.example',
		state: 'published',
		uri: 'at://did:web:owner.example/at.margin.note/3jzfcijpj2z2a'
	}
	let next: (values: Publication[]) => void = () => {}
	const release = vi.fn(),
		clock = new SimulatedClock()
	const actor = createActor(publicationCleanupMachine, {
		input: {
			capability: {
				libraryId: publication.libraryId,
				isCurrent: () => true,
				observe: (observe, deletions) => {
					next = (values) => {
						observe(values)
						deletions(
							values.flatMap((value) => ('noteId' in value.source ? [value.source.noteId] : []))
						)
					}
					next([publication])
					return release
				}
			}
		},
		clock
	}).start()
	return {
		actor,
		publication,
		clock,
		release,
		connectivity,
		observe: (values: Publication[]) => next(values)
	}
}
afterEach(() => vi.unstubAllGlobals())
it('retries a failed request later and forgets suppression after native removal', async () => {
	let attempts = 0
	const fetch = vi.fn<typeof globalThis.fetch>(async (_path, init) => {
		attempts++
		const input = publicationBaseSchema.parse(JSON.parse(String(init?.body)))
		if (attempts === 1) throw new TypeError('Synthetic offline request')
		return Response.json({
			...input,
			state: 'unpublished',
			uri: 'at://did:web:owner.example/at.margin.note/3jzfcijpj2z2a'
		})
	})
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	try {
		await waitFor(f.actor, (s) => s.matches({ active: 'waiting' }))
		expect(attempts).toBe(1)
		f.clock.increment(30_000)
		await waitFor(f.actor, (s) => s.matches({ active: 'idle' }) && s.context.completed.length === 1)
		expect(attempts).toBe(2)
		expect(fetch.mock.calls[0]?.[0]).toBe('/api/publication/cleanup')
		f.observe([])
		f.observe([f.publication])
		await waitFor(f.actor, (s) => s.matches({ active: 'idle' }) && s.context.completed.length === 1)
		expect(attempts).toBe(3)
	} finally {
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.stop()
	}
	expect(f.release).toHaveBeenCalled()
})
it('aborts the active request and releases observation on library shutdown', async () => {
	const gate = Promise.withResolvers<Response>()
	let signal: AbortSignal | null | undefined
	vi.stubGlobal('fetch', async (_path: unknown, init?: RequestInit) => {
		signal = init?.signal
		return gate.promise
	})
	const f = fixture()
	await waitFor(f.actor, (s) => s.matches({ active: 'removing' }))
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('done')
	expect(signal?.aborted).toBe(true)
	expect(f.release).toHaveBeenCalledOnce()
	gate.resolve(Response.json({ ...f.publication, state: 'unpublished' }))
	await Promise.resolve()
	expect(f.actor.getSnapshot().status).toBe('done')
	f.actor.stop()
})
it('does not dispatch for a missing library capability', () => {
	const fetch = vi.fn()
	vi.stubGlobal('fetch', fetch)
	const actor = createActor(publicationCleanupMachine, { input: { capability: undefined } }).start()
	expect(actor.getSnapshot().status).toBe('done')
	expect(fetch).not.toHaveBeenCalled()
	actor.stop()
})

it('retries promptly after an online event', async () => {
	let attempts = 0
	vi.stubGlobal('fetch', async (_path: unknown, init?: RequestInit) => {
		if (++attempts === 1) throw new TypeError('Synthetic offline request')
		const input = publicationBaseSchema.parse(JSON.parse(String(init?.body)))
		return Response.json({
			...input,
			state: 'unpublished',
			uri: 'at://did:web:owner.example/at.margin.note/3jzfcijpj2z2a'
		})
	})
	const f = fixture()
	try {
		await waitFor(f.actor, (s) => s.matches({ active: 'waiting' }))
		f.connectivity(true)
		await waitFor(f.actor, (s) => s.matches({ active: 'idle' }) && s.context.completed.length === 1)
		expect(attempts).toBe(2)
	} finally {
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.stop()
	}
})
