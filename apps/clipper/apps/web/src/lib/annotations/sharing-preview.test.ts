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

it('publishes the displayed selection once and exposes an address only after confirmation', async () => {
	const a = fixture()
	const published = {
		libraryId: a.value.libraryId,
		source: a.value.source,
		publishingDid: a.value.publishingDid,
		state: 'published',
		uri: 'at://did:web:fixture.example/at.margin.note/3jzfcijpj2z2a'
	}
	const gate = Promise.withResolvers<Response>()
	const fetch = vi.fn<typeof globalThis.fetch>(async (path) =>
		path === '/api/publication/preview' ? Response.json(a.value) : gate.promise
	)
	vi.stubGlobal('fetch', fetch)
	a.actor.send({ type: 'SHOW', note: a.note })
	await ready(a)
	const requestId = selectSharingPreview(a.actor.getSnapshot()).requestId
	a.actor.send({ type: 'PUBLISH', requestId: requestId - 1 })
	expect(fetch).toHaveBeenCalledTimes(1)
	a.actor.send({ type: 'PUBLISH', requestId })
	a.actor.send({ type: 'PUBLISH', requestId })
	expect(selectSharingPreview(a.actor.getSnapshot()).pending).toBe(true)
	expect(selectSharingPreview(a.actor.getSnapshot()).publication).toBeUndefined()
	const [url, init] = fetch.mock.calls[1] ?? []
	expect(url).toBe('/api/publication/publish')
	expect(JSON.parse(String(init?.body))).toEqual({
		libraryId: a.value.libraryId,
		source: a.value.source,
		publishingDid: a.value.publishingDid
	})
	expect(fetch).toHaveBeenCalledTimes(2)
	gate.resolve(Response.json(published))
	await waitFor(a.actor, (s) => s.matches('published'))
	expect(selectSharingPreview(a.actor.getSnapshot()).publication).toEqual(published)
	expect(selectSharingPreview(a.actor.getSnapshot()).message).toEqual({
		text: 'Published',
		variant: 'info'
	})
	expect(selectSharingPreview(a.actor.getSnapshot()).canPublish).toBe(false)
})
it('offers provider sign-in after missing permission and keeps failed publishing retryable', async () => {
	const a = fixture()
	let status = 403
	vi.stubGlobal('fetch', async (path: unknown) =>
		path === '/api/publication/preview' ? Response.json(a.value) : new Response(null, { status })
	)
	a.actor.send({ type: 'SHOW', note: a.note })
	await ready(a)
	a.actor.send({
		type: 'PUBLISH',
		requestId: selectSharingPreview(a.actor.getSnapshot()).requestId
	})
	await waitFor(a.actor, (s) => s.matches('authorize'))
	expect(selectSharingPreview(a.actor.getSnapshot()).authorize).toBe(true)
	expect(selectSharingPreview(a.actor.getSnapshot()).publication).toBeUndefined()
	a.actor.send({ type: 'SHOW', note: a.note })
	await ready(a)
	status = 503
	a.actor.send({
		type: 'PUBLISH',
		requestId: selectSharingPreview(a.actor.getSnapshot()).requestId
	})
	await waitFor(a.actor, (s) => s.matches('publishFailed'))
	expect(selectSharingPreview(a.actor.getSnapshot()).canPublish).toBe(true)
	expect(selectSharingPreview(a.actor.getSnapshot()).message).toEqual({
		text: 'Publishing could not be confirmed. Try again.',
		variant: 'error'
	})
	expect(selectSharingPreview(a.actor.getSnapshot()).publication).toBeUndefined()
})
it('dismisses in-flight publishing and ignores its late successful result', async () => {
	const a = fixture(),
		gate = Promise.withResolvers<Response>()
	let signal: AbortSignal | null | undefined
	vi.stubGlobal('fetch', async (path: unknown, init?: RequestInit) => {
		if (path === '/api/publication/preview') return Response.json(a.value)
		signal = init?.signal
		return gate.promise
	})
	a.actor.send({ type: 'SHOW', note: a.note })
	await ready(a)
	a.actor.send({
		type: 'PUBLISH',
		requestId: selectSharingPreview(a.actor.getSnapshot()).requestId
	})
	a.actor.send({ type: 'DISMISS' })
	expect(signal?.aborted).toBe(true)
	gate.resolve(
		Response.json({
			...a.value,
			state: 'published',
			uri: 'at://did:web:fixture.example/at.margin.note/3jzfcijpj2z2a'
		})
	)
	await Promise.resolve()
	expect(selectSharingPreview(a.actor.getSnapshot()).open).toBe(false)
	expect(selectSharingPreview(a.actor.getSnapshot()).publication).toBeUndefined()
})

it('unpublishes the current record and hides its address while retaining republish', async () => {
	const a = fixture()
	const published = {
		libraryId: a.value.libraryId,
		source: a.value.source,
		publishingDid: a.value.publishingDid,
		state: 'published',
		uri: 'at://did:web:fixture.example/at.margin.note/3jzfcijpj2z2a'
	}
	const fetch = vi.fn<typeof globalThis.fetch>(async (path) =>
		path === '/api/publication/preview'
			? Response.json(published)
			: Response.json({ ...published, state: 'unpublished' })
	)
	vi.stubGlobal('fetch', fetch)
	a.actor.send({ type: 'SHOW', note: a.note })
	await waitFor(a.actor, (s) => s.matches('published'))
	expect(selectSharingPreview(a.actor.getSnapshot()).canUnpublish).toBe(true)
	a.actor.send({
		type: 'UNPUBLISH',
		requestId: selectSharingPreview(a.actor.getSnapshot()).requestId
	})
	await waitFor(a.actor, (s) => s.matches('unpublished'))
	const view = selectSharingPreview(a.actor.getSnapshot())
	expect(view.message).toEqual({ text: 'Unpublished', variant: 'info' })
	expect(view.publication).toBeUndefined()
	expect(view.canPublish).toBe(true)
	expect(view.canUnpublish).toBe(false)
	expect(fetch.mock.calls[1]?.[0]).toBe('/api/publication/unpublish')
})
it('keeps an unconfirmed removal retryable without offering another publish', async () => {
	const a = fixture()
	const value = {
		libraryId: a.value.libraryId,
		source: a.value.source,
		publishingDid: a.value.publishingDid,
		state: 'unpublishing',
		uri: 'at://did:web:fixture.example/at.margin.note/3jzfcijpj2z2a',
		cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
	}
	vi.stubGlobal('fetch', async () => Response.json(value))
	a.actor.send({ type: 'SHOW', note: a.note })
	await waitFor(a.actor, (s) => s.matches('unpublishFailed'))
	const view = selectSharingPreview(a.actor.getSnapshot())
	expect(view.canUnpublish).toBe(true)
	expect(view.canPublish).toBe(false)
	expect(view.publication).toBeUndefined()
})
