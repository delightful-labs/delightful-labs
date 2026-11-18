import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'
import { policySchema } from '../../backend/jazz/schema-permissions.test-support.js'
import { createPreviewRequest, handlePreviewRequest } from './request.js'
import type { PreviewAuth } from './request.js'
import { origin, requestFixture } from './request.test-support.js'
import { createPublicationOwner } from './owner.test-support.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => fixture?.shutdown())
const setup = (name: string) => requestFixture({ fixture, name })
type Fixture = Awaited<ReturnType<typeof setup>>
function request(
	a: Fixture,
	changes: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}
) {
	return new Request(origin + '/api/publication/preview', {
		method: 'POST',
		headers: {
			origin,
			'content-type': 'application/json',
			cookie: a.credentials.cookie,
			...changes.headers
		},
		body: JSON.stringify(
			changes.body ?? { libraryId: a.owner.libraryId, source: { noteId: a.owner.noteId } }
		),
		...(changes.signal ? { signal: changes.signal } : {})
	})
}
function backend(a: Fixture) {
	// Canonical mapping is a controlled boundary here; native Jazz accountFor
	// authentication is independently qualified by gateway-auth.integration.test.
	return { db: a.owner.backend, accountFor: vi.fn(async () => a.owner.libraryId) }
}
function deferred() {
	let resolve = () => {}
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve: () => resolve() }
}
function holdRecheck(a: Fixture) {
	const entered = deferred(),
		gate = deferred()
	let calls = 0
	const getSession: PreviewAuth['api']['getSession'] = async (input) => {
		if (++calls === 2) {
			entered.resolve()
			await gate.promise
		}
		return a.auth.api.getSession(input)
	}
	return { auth: { api: { getSession } }, entered: entered.promise, release: gate.resolve }
}

it('uses a real native cookie session and returns only the approved private no-store preview', async () => {
	const a = await setup('request-owned'),
		scope = backend(a)
	const getSession = vi.fn<PreviewAuth['api']['getSession']>((input) =>
		a.auth.api.getSession(input)
	)
	const response = await handlePreviewRequest({ api: { getSession } }, scope, request(a), origin)
	expect(response.status).toBe(200)
	expect(response.headers.get('cache-control')).toBe('private, no-store')
	expect(response.headers.get('vary')).toBe('Cookie')
	expect(response.headers.get('set-cookie')).toBeNull()
	const body: unknown = await response.json()
	expect(body).toEqual({
		libraryId: a.owner.libraryId,
		source: { noteId: a.owner.noteId },
		publishingDid: a.owner.scope.publishingDid,
		record: {
			$type: 'at.margin.note',
			motivation: 'commenting',
			target: { source: 'https://example.org/article' },
			body: { value: 'Private document note', format: 'text/plain' },
			createdAt: expect.any(String)
		}
	})
	expect(getSession).toHaveBeenCalledTimes(2)
	for (const [input] of getSession.mock.calls)
		expect(input.query).toEqual({ disableCookieCache: true, disableRefresh: true })
	expect(scope.accountFor).toHaveBeenCalledTimes(2)
	expect(
		await a.owner.backend.all(app.publications.where({ libraryId: a.owner.libraryId }))
	).toEqual([])
})

it('rejects absent, tampered, expired and revoked native sessions before canonical account admission', async () => {
	const a = await setup('request-session'),
		scope = backend(a)
	for (const cookie of ['', a.credentials.cookie + 'tampered']) {
		expect(
			(await handlePreviewRequest(a.auth, scope, request(a, { headers: { cookie } }), origin))
				.status
		).toBe(401)
	}
	await a.owner.backend
		.update(app.better_auth_session, a.credentials.sessionId, {
			expiresAt: new Date(Date.now() - 60_000)
		})
		.wait({ tier: 'global' })
	expect((await handlePreviewRequest(a.auth, scope, request(a), origin)).status).toBe(401)
	const revoked = await setup('request-revoked'),
		revokedScope = backend(revoked)
	await revoked.owner.backend
		.delete(app.better_auth_session, revoked.credentials.sessionId)
		.wait({ tier: 'global' })
	expect(
		(await handlePreviewRequest(revoked.auth, revokedScope, request(revoked), origin)).status
	).toBe(401)
	expect(scope.accountFor).not.toHaveBeenCalled()
	expect(revokedScope.accountFor).not.toHaveBeenCalled()
})

it('requires both an AT profile and its linked provider account, and an existing canonical Jazz account', async () => {
	const a = await setup('request-provider'),
		scope = backend(a)
	await a.owner.backend
		.update(app.better_auth_user, a.owner.libraryId, { atprotoDid: null })
		.wait({ tier: 'global' })
	expect((await handlePreviewRequest(a.auth, scope, request(a), origin)).status).toBe(401)
	await a.owner.backend
		.update(app.better_auth_user, a.owner.libraryId, { atprotoDid: a.owner.scope.publishingDid })
		.wait({ tier: 'global' })
	expect(
		(
			await handlePreviewRequest(
				a.auth,
				{ ...scope, accountFor: async () => null },
				request(a),
				origin
			)
		).status
	).toBe(401)
	await a.owner.backend
		.delete(app.better_auth_account, a.credentials.accountId)
		.wait({ tier: 'global' })
	expect((await handlePreviewRequest(a.auth, scope, request(a), origin)).status).toBe(401)
})

it('refuses foreign sources/libraries, attached notes and unavailable public roots without returning content', async () => {
	const a = await setup('request-private'),
		scope = backend(a)
	const b = await createPublicationOwner({
		fixture,
		name: 'request-foreign',
		publishingDid: a.owner.scope.publishingDid,
		noteText: 'Foreign secret',
		withHighlight: true
	})
	for (const body of [
		{ libraryId: b.libraryId, source: { noteId: b.noteId } },
		{ libraryId: a.owner.libraryId, source: { noteId: b.noteId } },
		{ libraryId: a.owner.libraryId, source: { highlightId: b.highlightId } }
	]) {
		const response = await handlePreviewRequest(a.auth, scope, request(a, { body }), origin)
		expect(response.status).toBe(409)
		expect(await response.text()).toBe('')
	}
	await a.owner.backend
		.update(app.libraryDocuments, a.owner.documentId, {
			status: 'trashed',
			previousStatus: 'inbox'
		})
		.wait({ tier: 'global' })
	expect((await handlePreviewRequest(a.auth, scope, request(a), origin)).status).toBe(409)
})

it('rejects cross-origin requests and client-supplied destination/content/time before authentication', async () => {
	const a = await setup('request-input'),
		scope = backend(a)
	const getSession = vi.fn<PreviewAuth['api']['getSession']>((input) =>
		a.auth.api.getSession(input)
	)
	const auth = { api: { getSession } }
	expect(
		(
			await handlePreviewRequest(
				auth,
				scope,
				request(a, { headers: { authorization: 'Bearer unrelated-proof' } }),
				origin
			)
		).status
	).toBe(403)
	expect(
		(
			await handlePreviewRequest(
				auth,
				scope,
				request(a, { headers: { origin: 'https://evil.invalid' } }),
				origin
			)
		).status
	).toBe(403)
	expect(
		(
			await handlePreviewRequest(
				auth,
				scope,
				request(a, { headers: { 'content-type': 'text/plain' } }),
				origin
			)
		).status
	).toBe(400)
	for (const body of [
		{
			libraryId: a.owner.libraryId,
			source: { noteId: a.owner.noteId },
			publishingDid: 'did:web:evil.invalid'
		},
		{
			libraryId: a.owner.libraryId,
			source: { noteId: a.owner.noteId },
			createdAt: new Date().toISOString()
		},
		{ libraryId: a.owner.libraryId, source: { noteId: a.owner.noteId }, record: {} },
		{
			libraryId: a.owner.libraryId,
			source: { noteId: a.owner.noteId, highlightId: crypto.randomUUID() }
		},
		{ libraryId: 'invalid', source: { noteId: a.owner.noteId } },
		'x'.repeat(2049)
	])
		expect((await handlePreviewRequest(auth, scope, request(a, { body }), origin)).status).toBe(400)
	expect(getSession).not.toHaveBeenCalled()
	expect(scope.accountFor).not.toHaveBeenCalled()
})

it('discards a prepared preview when its native session, destination or provider link changes before disclosure', async () => {
	for (const change of ['revoke', 'destination', 'unlink']) {
		const a = await setup('request-recheck-' + change),
			held = holdRecheck(a)
		const result = handlePreviewRequest(held.auth, backend(a), request(a), origin)
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
			const response = await result
			expect(response.status).toBe(401)
			expect(await response.text()).toBe('')
		} finally {
			held.release()
		}
	}
})

it('cancels and releases a stalled request-body reader on the request deadline', async () => {
	const a = await setup('request-stream'),
		clock = new SimulatedClock()
	const cancel = vi.fn()
	const body = new ReadableStream<Uint8Array>({ cancel })
	const init = {
		method: 'POST',
		headers: { origin, 'content-type': 'application/json', cookie: a.credentials.cookie },
		body,
		duplex: 'half'
	}
	const incoming = new Request(origin + '/api/publication/preview', init)
	const scope = backend(a)
	const actor = createActor(createPreviewRequest(a.auth, scope), {
		input: { request: incoming, origin },
		clock
	})
	const result = toPromise(actor)
	actor.start()
	try {
		expect(actor.getSnapshot().matches('readingInput')).toBe(true)
		clock.increment(45_000)
		expect((await result).status).toBe(503)
		await Promise.resolve()
		await Promise.resolve()
		expect(cancel).toHaveBeenCalledTimes(1)
		expect(body.locked).toBe(false)
		expect(scope.accountFor).not.toHaveBeenCalled()
	} finally {
		actor.stop()
	}
})

it('refuses a changed canonical account at the final binding check', async () => {
	const a = await setup('request-canonical-recheck')
	let calls = 0
	const scope = {
		db: a.owner.backend,
		accountFor: async () => (++calls === 1 ? a.owner.libraryId : crypto.randomUUID())
	}
	expect((await handlePreviewRequest(a.auth, scope, request(a), origin)).status).toBe(401)
})

it('disconnects an in-flight recheck and ignores its late completion', async () => {
	const a = await setup('request-abort'),
		held = holdRecheck(a),
		controller = new AbortController()
	const result = handlePreviewRequest(
		held.auth,
		backend(a),
		request(a, { signal: controller.signal }),
		origin
	)
	try {
		await held.entered
		controller.abort()
		await expect(result).rejects.toMatchObject({ name: 'AbortError' })
	} finally {
		held.release()
	}
})

it('bounds stalled authentication and sanitizes unexpected native errors', async () => {
	const a = await setup('request-deadline'),
		entered = deferred(),
		gate = deferred(),
		clock = new SimulatedClock()
	const auth: PreviewAuth = {
		api: {
			getSession: async () => {
				entered.resolve()
				await gate.promise
				return null
			}
		}
	}
	const actor = createActor(createPreviewRequest(auth, backend(a)), {
		input: { request: request(a), origin },
		clock
	})
	const result = toPromise(actor)
	actor.start()
	try {
		await entered.promise
		clock.increment(45_000)
		const response = await result
		expect(response.status).toBe(503)
		expect(await response.text()).toBe('')
	} finally {
		gate.resolve()
		actor.stop()
	}
	const failed: PreviewAuth = {
		api: {
			getSession: async () => {
				throw new Error('Private native details')
			}
		}
	}
	const response = await handlePreviewRequest(failed, backend(a), request(a), origin)
	expect(response.status).toBe(503)
	expect(await response.text()).toBe('')
})
