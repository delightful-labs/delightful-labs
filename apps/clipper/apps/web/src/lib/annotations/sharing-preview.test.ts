import { afterEach, expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise, waitFor } from 'xstate'
import { sharingPreviewMachine, selectSharingPreview } from './sharing-preview.js'
import type { AnnotationNote } from './schema.js'
import type { PublicationPreview } from './publication-preview.js'

const actors: ReturnType<typeof owner>[] = []
function owner(isCurrent = () => true) {
	const note: AnnotationNote = {
		id: crypto.randomUUID(),
		libraryId: crypto.randomUUID(),
		documentId: crypto.randomUUID(),
		highlightId: null,
		source: 'https://example.org/source',
		text: 'Saved café 🦊 note'
	}
	const clock = new SimulatedClock()
	const actor = createActor(sharingPreviewMachine, {
		input: { capability: { libraryId: note.libraryId, isCurrent } },
		clock
	}).start()
	const value: PublicationPreview = {
		libraryId: note.libraryId,
		source: { noteId: note.id },
		publishingDid: 'did:web:fixture.example',
		record: {
			$type: 'at.margin.note',
			motivation: 'commenting',
			target: { source: 'https://example.org/source' },
			body: { value: note.text, format: 'text/plain' },
			createdAt: '2026-11-16T12:00:00.000Z'
		}
	}
	return { actor, note, value, clock }
}
function fixture(isCurrent?: () => boolean) {
	const value = owner(isCurrent)
	actors.push(value)
	return value
}
afterEach(() => {
	for (const a of actors.splice(0)) a.actor.stop()
	vi.unstubAllGlobals()
})
const ready = (a: ReturnType<typeof owner>) =>
	waitFor(a.actor, (s) => s.matches('ready'), { timeout: 1000 })
const unavailable = (a: ReturnType<typeof owner>) =>
	waitFor(a.actor, (s) => s.matches('unavailable'), { timeout: 1000 })

it('posts only the selected private identity and projects the approved returned snapshot', async () => {
	const a = fixture(),
		fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(a.value))
	vi.stubGlobal('fetch', fetch)
	a.actor.send({ type: 'SHOW', note: a.note })
	expect(selectSharingPreview(a.actor.getSnapshot()).message?.text).toBe('Preparing…')
	await ready(a)
	expect(selectSharingPreview(a.actor.getSnapshot()).value).toEqual(a.value)
	const [url, options] = fetch.mock.calls[0] ?? []
	expect(url).toBe('/api/publication/preview')
	expect(options).toMatchObject({
		method: 'POST',
		credentials: 'same-origin',
		cache: 'no-store',
		redirect: 'error'
	})
	expect(JSON.parse(String(options?.body))).toEqual({
		libraryId: a.note.libraryId,
		source: { noteId: a.note.id }
	})
})

it('refuses stale or mismatched response content and scopes without exposing it', async () => {
	const a = fixture()
	for (const value of [
		{ ...a.value, libraryId: crypto.randomUUID() },
		{ ...a.value, source: { noteId: crypto.randomUUID() } },
		{
			...a.value,
			record: { ...a.value.record, body: { value: 'Older server text', format: 'text/plain' } }
		},
		{ ...a.value, record: { ...a.value.record, target: { source: 'https://different.example/' } } },
		{
			...a.value,
			record: {
				...a.value.record,
				target: {
					source: a.note.source,
					selector: { type: 'TextQuoteSelector', exact: 'unexpected passage' }
				}
			}
		}
	]) {
		vi.stubGlobal('fetch', async () => Response.json(value))
		a.actor.send({ type: 'SHOW', note: a.note })
		await unavailable(a)
		expect(selectSharingPreview(a.actor.getSnapshot()).value).toBeUndefined()
	}
})

it('cancels dismissal, ignores late responses and correlates native close events across reopening', async () => {
	const a = fixture(),
		responses = Promise.withResolvers<Response>()
	let signal: AbortSignal | null | undefined
	vi.stubGlobal('fetch', (_url: unknown, init?: RequestInit) => {
		signal = init?.signal
		return responses.promise
	})
	a.actor.send({ type: 'SHOW', note: a.note })
	const previous = selectSharingPreview(a.actor.getSnapshot()).requestId
	a.actor.send({ type: 'DISMISS', requestId: previous })
	expect(signal?.aborted).toBe(true)
	responses.resolve(Response.json(a.value))
	await Promise.resolve()
	expect(selectSharingPreview(a.actor.getSnapshot()).open).toBe(false)
	vi.stubGlobal('fetch', async () => Response.json(a.value))
	a.actor.send({ type: 'SHOW', note: a.note })
	a.actor.send({ type: 'DISMISS', requestId: previous })
	await ready(a)
	expect(selectSharingPreview(a.actor.getSnapshot()).open).toBe(true)
})

it('invalidates changed/deleted observations and explicitly edited notes while retaining unrelated updates', async () => {
	const a = fixture()
	vi.stubGlobal('fetch', async () => Response.json(a.value))
	for (const event of [
		{ type: 'OBSERVED', notes: [{ ...a.note, text: 'Newer source' }] },
		{ type: 'OBSERVED', notes: [] },
		{ type: 'INVALIDATED', noteId: a.note.id }
	] satisfies Parameters<typeof a.actor.send>[0][]) {
		a.actor.send({ type: 'SHOW', note: a.note })
		await ready(a)
		a.actor.send({ type: 'INVALIDATED', noteId: crypto.randomUUID() })
		expect(selectSharingPreview(a.actor.getSnapshot()).open).toBe(true)
		a.actor.send(event)
		expect(selectSharingPreview(a.actor.getSnapshot()).open).toBe(false)
	}
})

it('refuses inactive/foreign/attached selections before fetching and expires an in-flight scope', async () => {
	let current = false
	const a = fixture(() => current),
		response = Promise.withResolvers<Response>()
	const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise)
	vi.stubGlobal('fetch', fetch)
	a.actor.send({ type: 'SHOW', note: a.note })
	current = true
	for (const note of [
		{ ...a.note, libraryId: crypto.randomUUID() },
		{ ...a.note, highlightId: crypto.randomUUID(), documentId: null }
	])
		a.actor.send({ type: 'SHOW', note })
	expect(fetch).not.toHaveBeenCalled()
	a.actor.send({ type: 'SHOW', note: a.note })
	current = false
	response.resolve(Response.json(a.value))
	await unavailable(a)
	expect(selectSharingPreview(a.actor.getSnapshot()).open).toBe(false)
})

it('contains errors, permits a fresh retry and aborts timeout or shutdown', async () => {
	const a = fixture()
	vi.stubGlobal('fetch', async () => new Response('Private failure details', { status: 401 }))
	a.actor.send({ type: 'SHOW', note: a.note })
	await unavailable(a)
	expect(selectSharingPreview(a.actor.getSnapshot()).message?.text).toBe(
		'Sharing preview is unavailable. Check your AT Protocol sign-in and saved note, then try again.'
	)
	vi.stubGlobal('fetch', async () => Response.json(a.value))
	a.actor.send({ type: 'SHOW', note: a.note })
	await ready(a)
	const pending = Promise.withResolvers<Response>()
	let signal: AbortSignal | null | undefined
	vi.stubGlobal('fetch', (_url: unknown, init?: RequestInit) => {
		signal = init?.signal
		return pending.promise
	})
	a.actor.send({ type: 'SHOW', note: a.note })
	a.clock.increment(50_000)
	expect(signal?.aborted).toBe(true)
	expect(selectSharingPreview(a.actor.getSnapshot()).retry).toBe(true)
	a.actor.send({ type: 'SHOW', note: a.note })
	a.actor.send({ type: 'SHUTDOWN' })
	await toPromise(a.actor)
	expect(signal?.aborted).toBe(true)
	expect(selectSharingPreview(a.actor.getSnapshot()).value).toBeUndefined()
	pending.resolve(Response.json(a.value))
})
