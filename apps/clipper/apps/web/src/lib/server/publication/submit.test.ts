import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'
import { policySchema } from '../../backend/jazz/schema-permissions.test-support.js'
import { publicationFromRow } from '../../annotations/publication.js'
import { createPublicationSubmit, handlePublicationSubmit } from './submit.js'
import { origin, requestFixture } from './request.test-support.js'
import type { PublicationAuth } from './access.js'
import * as access from './access.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => fixture?.shutdown())
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
const setup = (name: string) => requestFixture({ fixture, name })
type Fixture = Awaited<ReturnType<typeof setup>>
function selection(a: Fixture) {
	return {
		libraryId: a.owner.libraryId,
		source: { noteId: a.owner.noteId },
		publishingDid: a.owner.scope.publishingDid
	}
}
function request(
	a: Fixture,
	changes: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}
) {
	return new Request(origin + '/api/publication/request', {
		method: 'POST',
		headers: {
			origin,
			'content-type': 'application/json',
			cookie: a.credentials.cookie,
			...changes.headers
		},
		body: JSON.stringify(changes.body ?? selection(a)),
		...(changes.signal ? { signal: changes.signal } : {})
	})
}
function backend(a: Fixture) {
	// Native account mapping is independently exercised in the browser flow.
	return { db: a.owner.backend, accountFor: vi.fn(async () => a.owner.libraryId) }
}
const rows = (a: Fixture) =>
	a.owner.backend.all(app.publications.where({ libraryId: a.owner.libraryId }))
function holdRecheck(a: Fixture) {
	const entered = Promise.withResolvers<void>(),
		gate = Promise.withResolvers<void>()
	let calls = 0
	const getSession: PublicationAuth['api']['getSession'] = async (input) => {
		if (++calls === 2) {
			entered.resolve()
			await gate.promise
		}
		return a.auth.api.getSession(input)
	}
	return { auth: { api: { getSession } }, entered: entered.promise, release: () => gate.resolve() }
}

it('accepts only a requested choice after native acceptance and repeats without duplicating rows/history', async () => {
	const a = await setup('submit-owned'),
		scope = backend(a)
	const network = vi.fn<typeof fetch>(async () => {
		throw new Error('Unexpected PDS request')
	})
	vi.stubGlobal('fetch', network)
	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await handlePublicationSubmit(a.auth, scope, request(a), origin)
		expect(response.status).toBe(202)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(response.headers.get('vary')).toBe('Cookie')
		expect(response.headers.get('set-cookie')).toBeNull()
		expect(await response.json()).toEqual({ ...selection(a), state: 'requested' })
	}
	const stored = await rows(a)
	expect(stored).toHaveLength(1)
	const row = stored[0]
	if (!row) throw new Error('Expected accepted publication')
	expect(publicationFromRow(row)).toEqual({ ...selection(a), state: 'requested' })
	expect(await a.owner.backend.all(app.$history.publications.where({ id: row.id }))).toHaveLength(1)
	expect((await a.owner.backend.one(app.notes.where({ id: a.owner.noteId })))?.text).toBe(
		'Private document note'
	)
	expect(network).not.toHaveBeenCalled()
})

it('rejects malformed or forged bodies, foreign origins and mixed proof before identity reads', async () => {
	const a = await setup('submit-input'),
		scope = backend(a)
	const getSession = vi.fn<PublicationAuth['api']['getSession']>((input) =>
		a.auth.api.getSession(input)
	)
	const auth = { api: { getSession } }
	for (const headers of [{ origin: 'https://evil.invalid' }, { authorization: 'Bearer other' }])
		expect(
			(await handlePublicationSubmit(auth, scope, request(a, { headers }), origin)).status
		).toBe(403)
	expect(
		(
			await handlePublicationSubmit(
				auth,
				scope,
				request(a, { headers: { 'content-type': 'text/plain' } }),
				origin
			)
		).status
	).toBe(400)
	for (const body of [
		{ ...selection(a), state: 'published' },
		{ ...selection(a), uri: 'at://did:web:evil.invalid/at.margin.note/x' },
		{ ...selection(a), record: {} },
		{ ...selection(a), publishingDid: 'invalid' },
		{ ...selection(a), source: { noteId: a.owner.noteId, highlightId: crypto.randomUUID() } },
		{ ...selection(a), libraryId: 'invalid' },
		'x'.repeat(4097)
	])
		expect((await handlePublicationSubmit(auth, scope, request(a, { body }), origin)).status).toBe(
			400
		)
	expect(getSession).not.toHaveBeenCalled()
	expect(scope.accountFor).not.toHaveBeenCalled()
	expect(await rows(a)).toEqual([])
})

it('requires a valid native cookie and the exact selected publishing account', async () => {
	const a = await setup('submit-session'),
		scope = backend(a)
	for (const cookie of ['', a.credentials.cookie + 'tampered'])
		expect(
			(await handlePublicationSubmit(a.auth, scope, request(a, { headers: { cookie } }), origin))
				.status
		).toBe(401)
	expect(
		(
			await handlePublicationSubmit(
				a.auth,
				scope,
				request(a, { body: { ...selection(a), publishingDid: 'did:web:other.invalid' } }),
				origin
			)
		).status
	).toBe(409)
	await a.owner.backend
		.delete(app.better_auth_session, a.credentials.sessionId)
		.wait({ tier: 'global' })
	expect((await handlePublicationSubmit(a.auth, scope, request(a), origin)).status).toBe(401)
	expect(await rows(a)).toEqual([])
})

it('refuses foreign, trashed and unrepresentable Notes without allocating a publication', async () => {
	const a = await setup('submit-source'),
		b = await setup('submit-foreign'),
		scope = backend(a)
	for (const body of [
		{ ...selection(a), source: { noteId: b.owner.noteId } },
		{ ...selection(a), libraryId: b.owner.libraryId },
		{ ...selection(a), source: { highlightId: crypto.randomUUID() } }
	])
		expect(
			(await handlePublicationSubmit(a.auth, scope, request(a, { body }), origin)).status
		).toBe(409)
	await a.owner.backend
		.update(app.notes, a.owner.noteId, { text: 'x'.repeat(3001) })
		.wait({ tier: 'global' })
	expect((await handlePublicationSubmit(a.auth, scope, request(a), origin)).status).toBe(409)
	await a.owner.backend
		.update(app.notes, a.owner.noteId, { text: 'Valid note' })
		.wait({ tier: 'global' })
	await a.owner.backend
		.update(app.libraryDocuments, a.owner.documentId, {
			status: 'trashed',
			previousStatus: 'inbox'
		})
		.wait({ tier: 'global' })
	expect((await handlePublicationSubmit(a.auth, scope, request(a), origin)).status).toBe(409)
	expect(await rows(a)).toEqual([])
})

it('rechecks session, destination and provider linking before starting a write', async () => {
	for (const change of ['revoke', 'destination', 'unlink']) {
		const a = await setup('submit-recheck-' + change),
			held = holdRecheck(a)
		const result = handlePublicationSubmit(held.auth, backend(a), request(a), origin)
		try {
			await held.entered
			if (change === 'revoke')
				await a.owner.backend
					.delete(app.better_auth_session, a.credentials.sessionId)
					.wait({ tier: 'global' })
			else if (change === 'destination')
				await a.owner.backend
					.update(app.better_auth_user, a.owner.libraryId, {
						atprotoDid: 'did:web:changed.invalid'
					})
					.wait({ tier: 'global' })
			else
				await a.owner.backend
					.delete(app.better_auth_account, a.credentials.accountId)
					.wait({ tier: 'global' })
			held.release()
			expect((await result).status).toBe(401)
			expect(await rows(a)).toEqual([])
		} finally {
			held.release()
		}
	}
})

it('serializes simultaneous requests and makes a later retry an observation of the accepted row', async () => {
	const a = await setup('submit-concurrent'),
		scope = backend(a)
	const responses = await Promise.all([
		handlePublicationSubmit(a.auth, scope, request(a), origin),
		handlePublicationSubmit(a.auth, scope, request(a), origin)
	])
	expect(responses.some((response) => response.status === 202)).toBe(true)
	// A native serializable commit rejection is a 503; domain refusals are 409.
	// Neither acknowledges success or retries the failed write automatically.
	expect(responses.every((response) => [202, 409, 503].includes(response.status))).toBe(true)
	expect((await handlePublicationSubmit(a.auth, scope, request(a), origin)).status).toBe(202)
	expect(await rows(a)).toHaveLength(1)
})

it('rejects authorization revoked after its transaction read through native serializable validation', async () => {
	const a = await setup('submit-transaction-revoke'),
		entered = Promise.withResolvers<void>(),
		gate = Promise.withResolvers<void>()
	const actual = access.authorizePublicationTransaction
	vi.spyOn(access, 'authorizePublicationTransaction').mockImplementation(async (tx, proof) => {
		const allowed = await actual(tx, proof)
		entered.resolve()
		await gate.promise
		return allowed
	})
	const result = handlePublicationSubmit(a.auth, backend(a), request(a), origin)
	try {
		await entered.promise
		await a.owner.backend
			.delete(app.better_auth_session, a.credentials.sessionId)
			.wait({ tier: 'global' })
		gate.resolve()
		expect((await result).status).not.toBe(202)
		expect(await rows(a)).toEqual([])
	} finally {
		gate.resolve()
	}
})

it('drains a cancelled native preparation and never acknowledges it as a successful request', async () => {
	const a = await setup('submit-drain'),
		entered = Promise.withResolvers<void>(),
		gate = Promise.withResolvers<void>()
	const actual = access.authorizePublicationTransaction
	vi.spyOn(access, 'authorizePublicationTransaction').mockImplementation(async (tx, proof) => {
		const allowed = await actual(tx, proof)
		entered.resolve()
		await gate.promise
		return allowed
	})
	const controller = new AbortController()
	const result = handlePublicationSubmit(
		a.auth,
		backend(a),
		request(a, { signal: controller.signal }),
		origin
	)
	const settled = result.then(
		() => true,
		() => true
	)
	try {
		await entered.promise
		controller.abort()
		gate.resolve()
		await expect(result).rejects.toMatchObject({ name: 'AbortError' })
		await settled
		expect(await rows(a)).toEqual([])
	} finally {
		gate.resolve()
	}
})

it('bounds a stalled request body and releases its reader before any identity or write operation', async () => {
	const a = await setup('submit-stream'),
		clock = new SimulatedClock(),
		cancel = vi.fn()
	const body = new ReadableStream<Uint8Array>({ cancel })
	const init = {
		method: 'POST',
		headers: { origin, 'content-type': 'application/json', cookie: a.credentials.cookie },
		body,
		duplex: 'half'
	}
	const incoming = new Request(origin + '/api/publication/request', init)
	const scope = backend(a),
		actor = createActor(createPublicationSubmit(a.auth, scope), {
			input: { request: incoming, origin },
			clock
		})
	const result = toPromise(actor)
	actor.start()
	try {
		expect(actor.getSnapshot().matches({ preparing: 'readingInput' })).toBe(true)
		clock.increment(30_000)
		expect((await result).status).toBe(503)
		expect(cancel).toHaveBeenCalledOnce()
		expect(scope.accountFor).not.toHaveBeenCalled()
		expect(await rows(a)).toEqual([])
	} finally {
		actor.stop()
	}
})

it('bounds native drain without acknowledging a stalled write or admitting its late completion', async () => {
	const a = await setup('submit-drain-deadline')
	const entered = Promise.withResolvers<void>(),
		gate = Promise.withResolvers<void>()
	const actual = access.authorizePublicationTransaction
	vi.spyOn(access, 'authorizePublicationTransaction').mockImplementation(async (tx, proof) => {
		const allowed = await actual(tx, proof)
		entered.resolve()
		await gate.promise
		return allowed
	})
	const clock = new SimulatedClock()
	const actor = createActor(createPublicationSubmit(a.auth, backend(a)), {
		input: { request: request(a), origin },
		clock
	})
	const result = toPromise(actor)
	actor.start()
	try {
		await entered.promise
		clock.increment(10_000)
		expect(actor.getSnapshot().matches({ persisting: 'draining' })).toBe(true)
		clock.increment(10_000)
		expect((await result).status).toBe(503)
		gate.resolve()
		await Promise.resolve()
		expect(await rows(a)).toEqual([])
		expect(actor.getSnapshot().status).toBe('done')
	} finally {
		gate.resolve()
		actor.stop()
	}
})
