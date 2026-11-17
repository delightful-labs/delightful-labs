import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
	createActor,
	createAsyncLogic,
	setup as setupMachine,
	SimulatedClock,
	toPromise,
	types,
	waitFor
} from 'xstate'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'
import { policySchema } from '../../backend/jazz/schema-permissions.test-support.js'
import { createPublicationPermission, handlePublicationPermission } from './permission.js'
import { handlePublicationPublish } from './publish.js'
import { cidSchema } from '../../annotations/publication-link.js'
import { firstPublicationWriteSchema } from './first-write.js'
import { publicationSchema } from '../../annotations/publication.js'
import { handlePublicationSubmit } from './submit.js'
import { origin, requestFixture } from './request.test-support.js'
import type { PublicationAuth } from './access.js'
import { pdsRead } from './pds-read.js'
import type { PdsReadSession } from './pds-read.js'
import { matchesIssuedContent } from './compare.js'

const pluginRequire = createRequire(import.meta.resolve('@kingironman2011/better-auth-bsky'))
const oauthPath = pathToFileURL(pluginRequire.resolve('@atcute/oauth-node-client')).href
const oauth: { OAuthClient: { prototype: { restore: (...args: unknown[]) => Promise<unknown> } } } =
	await import(oauthPath)

let fixture: PolicyTestApp
beforeEach(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterEach(async () => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	await fixture?.shutdown()
})
const setup = (name: string) => requestFixture({ fixture, name })
type Fixture = Awaited<ReturnType<typeof setup>>
const identity = 'atproto'
const granted = 'atproto repo:at.margin.note'
const issuer = 'https://issuer.example.invalid'
const pds = 'https://pds.example.invalid'
const requestedUrl = (input: Parameters<typeof fetch>[0]) =>
	input instanceof Request ? input.url : input.toString()
function sdkSession(did: string, getTokenInfo?: () => Promise<unknown>) {
	return {
		did,
		getTokenInfo,
		handle: async () => {
			throw new Error('Unexpected repository call')
		}
	}
}
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
	return new Request(origin + '/api/publication/permission', {
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
const backend = (a: Fixture) => ({
	db: a.owner.backend,
	accountFor: vi.fn(async () => a.owner.libraryId)
})

// The fixture uses the installed OAuth client and native plugin session store.
// Provider discovery/refresh and explicitly supplied repository responses are
// synthetic; the SDK and native session store are real. No live PDS is used.
function network(
	did: string,
	refreshScope = identity,
	revoked = false,
	read?: (request: Request) => Response | Promise<Response>
) {
	const fetcher = vi.fn<typeof fetch>(async (input, init) => {
		const req = new Request(input, init)
		if (
			read &&
			(req.url.startsWith(pds + '/xrpc/com.atproto.repo.getRecord?') ||
				req.url === pds + '/xrpc/com.atproto.repo.putRecord' ||
				req.url === pds + '/xrpc/com.atproto.repo.deleteRecord')
		)
			return read(req)
		if (req.url === issuer + '/.well-known/oauth-authorization-server')
			return Response.json({
				issuer,
				authorization_endpoint: issuer + '/authorize',
				token_endpoint: issuer + '/token',
				pushed_authorization_request_endpoint: issuer + '/par',
				revocation_endpoint: issuer + '/revoke',
				scopes_supported: ['atproto', 'repo:at.margin.note'],
				response_types_supported: ['code'],
				grant_types_supported: ['authorization_code', 'refresh_token'],
				token_endpoint_auth_methods_supported: ['none'],
				dpop_signing_alg_values_supported: ['ES256'],
				code_challenge_methods_supported: ['S256'],
				authorization_response_iss_parameter_supported: true,
				client_id_metadata_document_supported: true,
				require_pushed_authorization_requests: true
			})
		if (req.url === 'https://plc.directory/' + encodeURIComponent(did))
			return Response.json({
				'@context': ['https://www.w3.org/ns/did/v1'],
				id: did,
				alsoKnownAs: ['at://fixture.example.invalid'],
				service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }]
			})
		if (req.url === pds + '/.well-known/oauth-protected-resource')
			return Response.json({ resource: pds, authorization_servers: [issuer] })
		if (req.url === 'https://fixture.example.invalid/.well-known/atproto-did')
			return new Response(did)
		if (
			req.url ===
			'https://cloudflare-dns.com/dns-query?name=_atproto.fixture.example.invalid&type=TXT'
		)
			return Response.json({ Status: 0, Answer: [{ type: 16, data: '"did=' + did + '"' }] })
		if (req.url === issuer + '/token') {
			const body = new URLSearchParams(await req.text())
			expect(body.get('grant_type')).toBe('refresh_token')
			expect(req.headers.has('DPoP')).toBe(true)
			return revoked
				? Response.json({ error: 'invalid_grant' }, { status: 400 })
				: Response.json({
						token_type: 'DPoP',
						access_token: 'synthetic-access-after',
						refresh_token: 'synthetic-refresh-after',
						scope: refreshScope,
						sub: did,
						expires_in: 3600
					})
		}
		throw new Error('Unexpected provider or repository request')
	})
	vi.stubGlobal('fetch', fetcher)
	return fetcher
}

const keys = createAsyncLogic({
	run: async () => {
		const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
			'sign',
			'verify'
		])
		return { ...(await crypto.subtle.exportKey('jwk', pair.privateKey)), alg: 'ES256' }
	}
})
type ProviderInput = { a: Fixture; scope: string; expired: boolean }
type Key = import('xstate').OutputFrom<typeof keys>
const seed = createAsyncLogic({
	run: ({ input }: { input: ProviderInput & { key: Key } }) =>
		input.a.owner.backend
			.insert(app.better_auth_atprotoSession, {
				did: input.a.owner.scope.publishingDid,
				userId: input.a.owner.libraryId,
				handle: 'fixture.example.invalid',
				pdsUrl: pds,
				updatedAt: new Date(),
				sessionData: JSON.stringify({
					dpopKey: input.key,
					authMethod: { method: 'none' },
					tokenSet: {
						iss: issuer,
						sub: input.a.owner.scope.publishingDid,
						aud: pds,
						scope: input.scope,
						token_type: 'DPoP',
						access_token: 'synthetic-access-before',
						refresh_token: 'synthetic-refresh-before',
						expires_at: Date.now() + (input.expired ? -60_000 : 3_600_000)
					}
				})
			})
			.wait({ tier: 'global' })
})
const providerFixture = setupMachine({
	schemas: {
		input: types<ProviderInput>(),
		context: types<ProviderInput & { key: Key | undefined; error: unknown }>()
	},
	actors: { keys, seed },
	states: {
		keys: {},
		seeding: { schemas: { context: types<{ key: Key }>() } },
		ready: {},
		failed: {}
	}
}).createMachine({
	id: 'permission-provider-fixture',
	initial: 'keys',
	context: ({ input }) => ({ ...input, key: undefined, error: undefined }),
	states: {
		keys: {
			invoke: {
				src: 'keys',
				onDone: ({ event }) => ({ target: 'seeding', context: { key: event.output } }),
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		seeding: {
			invoke: {
				src: 'seed',
				input: ({ context }) => context,
				onDone: { target: 'ready' },
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		ready: { type: 'final' },
		failed: {
			type: 'final',
			output: ({ context }) => {
				throw context.error
			}
		}
	}
})
async function seedProvider(a: Fixture, scope: string, expired = false) {
	const actor = createActor(providerFixture, { input: { a, scope, expired } })
	try {
		const result = toPromise(actor)
		actor.start()
		await result
	} finally {
		actor.stop()
	}
}

for (const scope of [identity, granted, 'repo:at.margin.note atproto'])
	it(`observes the actual SDK grant ${scope} without changing publication intent`, async () => {
		const net = network('did:plc:ewvi7nxzyoun6zhxrhs64oiz')
		const a = await setup('permission-' + scope.replaceAll(':', '-').replaceAll(' ', '-'))
		// Deliberately invert linked-account metadata: it is not grant authority.
		await a.owner.backend
			.update(app.better_auth_account, a.credentials.accountId, {
				scope: scope === identity ? granted : identity
			})
			.wait({ tier: 'global' })
		await seedProvider(a, scope)
		const response = await handlePublicationPermission(a.auth, backend(a), request(a), origin)
		expect(response.status).toBe(scope === identity ? 409 : 204)
		expect(await response.text()).toBe('')
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(response.headers.get('vary')).toBe('Cookie')
		expect(response.headers.get('set-cookie')).toBeNull()
		expect(await a.owner.backend.all(app.publications)).toHaveLength(0)
		expect(net.mock.calls.every(([input]) => !requestedUrl(input).includes('/xrpc/'))).toBe(true)
	})

for (const scope of [identity, granted])
	it(`uses the refreshed SDK grant ${scope}, including a reduced grant`, async () => {
		const net = network('did:plc:ewvi7nxzyoun6zhxrhs64oiz', scope)
		const a = await setup('permission-refresh-' + scope.replaceAll(':', '-').replaceAll(' ', '-'))
		await seedProvider(a, scope === identity ? granted : identity, true)
		expect((await handlePublicationPermission(a.auth, backend(a), request(a), origin)).status).toBe(
			scope === identity ? 409 : 204
		)
		expect(
			net.mock.calls.filter(([input]) => requestedUrl(input) === issuer + '/token')
		).toHaveLength(1)
	})

it('does not mistake a missing or revoked provider session for permission', async () => {
	network('did:plc:ewvi7nxzyoun6zhxrhs64oiz', granted, true)
	const a = await setup('permission-revoked')
	expect((await handlePublicationPermission(a.auth, backend(a), request(a), origin)).status).toBe(
		503
	)
	await seedProvider(a, granted, true)
	expect((await handlePublicationPermission(a.auth, backend(a), request(a), origin)).status).toBe(
		503
	)
	expect(await a.owner.backend.all(app.better_auth_atprotoSession)).toHaveLength(0)
	expect(await a.owner.backend.all(app.publications)).toHaveLength(0)
})

it('rejects input/proof and ineligible sources before restoring any provider session', async () => {
	const restore = vi.spyOn(oauth.OAuthClient.prototype, 'restore')
	const a = await setup('permission-admission'),
		other = await setup('permission-foreign')
	const scope = backend(a)
	for (const [changes, status] of [
		[{ headers: { origin: 'https://other.invalid' } }, 403],
		[{ headers: { authorization: 'Bearer proof' } }, 403],
		[{ headers: { 'content-type': 'text/plain' } }, 400],
		[{ headers: { cookie: '' } }, 401],
		[{ body: { ...selection(a), state: 'requested' } }, 400],
		[{ body: { ...selection(a), scope: granted } }, 400],
		[{ body: { ...selection(a), publishingDid: 'x'.repeat(4097) } }, 400],
		[{ body: { ...selection(a), publishingDid: 'did:plc:other' } }, 409],
		[{ body: { ...selection(a), source: { highlightId: a.owner.highlightId } } }, 409],
		[{ body: { ...selection(a), source: { noteId: other.owner.noteId } } }, 409]
	] satisfies [Parameters<typeof request>[1], number][])
		expect(
			(await handlePublicationPermission(a.auth, scope, request(a, changes), origin)).status
		).toBe(status)
	await a.owner.backend
		.update(app.libraryDocuments, a.owner.documentId, { status: 'trashed' })
		.wait({ tier: 'global' })
	expect((await handlePublicationPermission(a.auth, scope, request(a), origin)).status).toBe(409)
	expect(restore).not.toHaveBeenCalled()
})

it('refuses malformed, mismatched, expired and insufficient SDK observations', async () => {
	const a = await setup('permission-observations')
	const did = a.owner.scope.publishingDid
	const restore = vi.spyOn(oauth.OAuthClient.prototype, 'restore')
	for (const value of [
		null,
		{},
		{ sub: 'did:plc:other', scope: granted },
		{ sub: did, scope: identity },
		{ sub: did, scope: 'atproto repo:at.margin.note?action=create' },
		{ sub: did, scope: 'atproto repo:at.margin.note.other' },
		{ sub: did, scope: granted, expired: true },
		{ sub: did, scope: granted, expiresAt: new Date(0) },
		{ sub: did, scope: granted, expiresAt: 'future' }
	]) {
		restore.mockResolvedValue(sdkSession(did, async () => value))
		expect((await handlePublicationPermission(a.auth, backend(a), request(a), origin)).status).toBe(
			409
		)
	}
	restore.mockResolvedValue(sdkSession('did:plc:other', async () => ({ sub: did, scope: granted })))
	expect((await handlePublicationPermission(a.auth, backend(a), request(a), origin)).status).toBe(
		409
	)
	restore.mockResolvedValue(sdkSession(did))
	expect((await handlePublicationPermission(a.auth, backend(a), request(a), origin)).status).toBe(
		409
	)
})

for (const change of ['session', 'destination', 'link'])
	it(`rechecks native ${change} after the provider observation`, async () => {
		const a = await setup('permission-recheck-' + change)
		const entered = Promise.withResolvers<void>(),
			gate = Promise.withResolvers<unknown>()
		vi.spyOn(oauth.OAuthClient.prototype, 'restore').mockResolvedValue(
			sdkSession(a.owner.scope.publishingDid, () => {
				entered.resolve()
				return gate.promise
			})
		)
		const result = handlePublicationPermission(a.auth, backend(a), request(a), origin)
		await entered.promise
		if (change === 'session')
			await a.owner.backend
				.delete(app.better_auth_session, a.credentials.sessionId)
				.wait({ tier: 'global' })
		if (change === 'destination')
			await a.owner.backend
				.update(app.better_auth_user, a.owner.libraryId, { atprotoDid: 'did:plc:changed' })
				.wait({ tier: 'global' })
		if (change === 'link')
			await a.owner.backend
				.delete(app.better_auth_account, a.credentials.accountId)
				.wait({ tier: 'global' })
		gate.resolve({ sub: a.owner.scope.publishingDid, scope: granted })
		expect((await result).status).toBe(401)
	})

it('observes a requested publication without changing its accepted lifecycle or history', async () => {
	network('did:plc:ewvi7nxzyoun6zhxrhs64oiz')
	const a = await setup('permission-requested'),
		scope = backend(a)
	await seedProvider(a, granted)
	expect((await handlePublicationSubmit(a.auth, scope, request(a), origin)).status).toBe(202)
	const before = await a.owner.backend.all(app.publications)
	expect((await handlePublicationPermission(a.auth, scope, request(a), origin)).status).toBe(204)
	const after = await a.owner.backend.all(app.publications)
	expect(after).toEqual(before)
	const row = after[0]
	if (!row) throw new Error('Expected requested publication')
	expect(row.lifecycle).toEqual({ state: 'requested' })
	expect(await a.owner.backend.all(app.$history.publications.where({ id: row.id }))).toHaveLength(1)
})

it('sanitizes SDK failures and discards late restoration after disconnect', async () => {
	const a = await setup('permission-disconnect')
	const restore = vi
		.spyOn(oauth.OAuthClient.prototype, 'restore')
		.mockRejectedValue(new Error('private provider detail'))
	const failed = await handlePublicationPermission(a.auth, backend(a), request(a), origin)
	expect(failed.status).toBe(503)
	expect(await failed.text()).toBe('')
	const gate = Promise.withResolvers<unknown>(),
		entered = Promise.withResolvers<void>()
	restore.mockImplementation(() => {
		entered.resolve()
		return gate.promise
	})
	const controller = new AbortController()
	const result = handlePublicationPermission(
		a.auth,
		backend(a),
		request(a, { signal: controller.signal }),
		origin
	)
	const aborted = expect(result).rejects.toMatchObject({ name: 'AbortError' })
	await entered.promise
	controller.abort()
	await aborted
	const getTokenInfo = vi.fn(async () => ({ sub: a.owner.scope.publishingDid, scope: granted }))
	gate.resolve(sdkSession(a.owner.scope.publishingDid, getTokenInfo))
	await Promise.resolve()
	await Promise.resolve()
	expect(getTokenInfo).not.toHaveBeenCalled()
	expect(await a.owner.backend.all(app.publications)).toHaveLength(0)
})

it('bounds stalled SDK token inspection and ignores its late successful result', async () => {
	const a = await setup('permission-deadline')
	const gate = Promise.withResolvers<unknown>()
	vi.spyOn(oauth.OAuthClient.prototype, 'restore').mockResolvedValue(
		sdkSession(a.owner.scope.publishingDid, () => gate.promise)
	)
	const clock = new SimulatedClock()
	const actor = createActor(createPublicationPermission(a.auth, backend(a)), {
		input: { request: request(a), origin },
		clock
	})
	const done = toPromise(actor)
	actor.start()
	try {
		await waitFor(actor, (snapshot) => snapshot.matches('checkingGrant'))
		clock.increment(30_000)
		expect((await done).status).toBe(503)
		gate.resolve({ sub: a.owner.scope.publishingDid, scope: granted })
		await Promise.resolve()
		await Promise.resolve()
		expect(actor.getSnapshot().matches('failed')).toBe(true)
		expect(await a.owner.backend.all(app.publications)).toHaveLength(0)
	} finally {
		gate.resolve(undefined)
		actor.stop()
	}
})

it('fails closed when the configured auth host lacks the server-only plugin capability', async () => {
	const a = await setup('permission-capability')
	const getSession: PublicationAuth['api']['getSession'] = (input) => a.auth.api.getSession(input)
	expect(
		(await handlePublicationPermission({ api: { getSession } }, backend(a), request(a), origin))
			.status
	).toBe(503)
})

function hasReadSession(value: unknown): value is { session: PdsReadSession } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'session' in value &&
		typeof value.session === 'object' &&
		value.session !== null &&
		'did' in value.session &&
		typeof value.session.did === 'string' &&
		'handle' in value.session &&
		typeof value.session.handle === 'function'
	)
}

for (const found of [true, false])
	it(`reads an explicit ${found ? 'found' : 'notFound'} outcome through the real restored plugin session`, async () => {
		const did = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
		const uri = `at://${did}/at.margin.note/3jzfcijpj2z2a`
		const frozenContent = {
			$type: 'at.margin.note',
			motivation: 'commenting',
			createdAt: '2026-11-17T12:00:00Z',
			target: { source: 'https://example.org/article' },
			body: { value: 'Private document note', format: 'text/plain' }
		}
		const record = { uri, value: { ...frozenContent, foreign: { retained: [true, null] } } }
		const read = vi.fn((request: Request) => {
			expect(request.method).toBe('GET')
			expect(request.headers.has('DPoP')).toBe(true)
			expect(request.headers.has('authorization')).toBe(true)
			expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
				repo: did,
				collection: 'at.margin.note',
				rkey: '3jzfcijpj2z2a'
			})
			return found
				? Response.json(record)
				: Response.json({ error: 'RecordNotFound' }, { status: 400 })
		})
		network(did, identity, false, read)
		const a = await setup('pds-native-' + found)
		await seedProvider(a, identity)
		const api: unknown = a.auth.api
		if (
			typeof api !== 'object' ||
			api === null ||
			!('getAtprotoClient' in api) ||
			typeof api.getAtprotoClient !== 'function'
		)
			throw new Error('Expected server-only SDK capability')
		const restored: unknown = await api.getAtprotoClient({ body: { did } })
		if (!hasReadSession(restored)) throw new Error('Expected native SDK session')
		const actor = createActor(pdsRead, {
			input: { uri, session: restored.session, isCurrent: () => true }
		})
		try {
			const result = toPromise(actor)
			actor.start()
			const observation = await result
			expect(observation).toEqual(found ? { status: 'found', record } : { status: 'notFound', uri })
			if (observation.status === 'found')
				expect(
					matchesIssuedContent(
						{
							...selection(a),
							state: 'issued',
							uri,
							record: frozenContent
						},
						observation.record
					)
				).toBe(true)
			expect(read).toHaveBeenCalledTimes(1)
			expect(await a.owner.backend.all(app.publications)).toHaveLength(0)
		} finally {
			actor.stop()
		}
	})

it('publishes through the real OAuth SDK, refreshes the grant and reads back before native confirmation', async () => {
	const records = new Map<string, unknown>()
	let writes = 0
	network('did:plc:ewvi7nxzyoun6zhxrhs64oiz', granted, false, async (req) => {
		expect(req.headers.has('DPoP')).toBe(true)
		expect(req.headers.get('Authorization')).toBe('DPoP synthetic-access-after')
		if (req.url.endsWith('/xrpc/com.atproto.repo.deleteRecord')) {
			const removal = firstPublicationWriteSchema
				.pick({ repo: true, collection: true, rkey: true })
				.extend({ swapRecord: cidSchema })
				.parse(await req.json())
			expect(removal.swapRecord).toBe('bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')
			const uri = 'at://' + removal.repo + '/' + removal.collection + '/' + removal.rkey
			records.delete(uri)
			return Response.json({})
		}
		if (req.method === 'POST') {
			const write = firstPublicationWriteSchema.parse(await req.json())
			const uri = 'at://' + write.repo + '/' + write.collection + '/' + write.rkey
			const rows = await a.owner.backend.all(
				app.publications.where({ libraryId: a.owner.libraryId })
			)
			expect(rows[0]?.lifecycle).toEqual({ state: 'issued', uri, record: write.record })
			expect(records.has(uri)).toBe(false)
			records.set(uri, write.record)
			writes++
			return Response.json({ uri, cid: 'unused-write-receipt' })
		}
		const params = new URL(req.url).searchParams
		const uri =
			'at://' + params.get('repo') + '/' + params.get('collection') + '/' + params.get('rkey')
		return records.has(uri)
			? Response.json({
					uri,
					value: records.get(uri),
					cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
				})
			: Response.json({ error: 'RecordNotFound' }, { status: 400 })
	})
	const a = await setup('publish-sdk')
	await seedProvider(a, granted, true)
	const response = await handlePublicationPublish(a.auth, backend(a), request(a), origin)
	expect(response.status).toBe(200)
	const published = publicationSchema.parse(await response.json())
	expect(published.state).toBe('published')
	expect(writes).toBe(1)
	const again = await handlePublicationPublish(a.auth, backend(a), request(a), origin)
	expect(await again.json()).toEqual(published)
	expect(writes).toBe(1)
	const removal = await handlePublicationPublish(
		a.auth,
		backend(a),
		request(a),
		origin,
		'unpublish'
	)
	expect(removal.status).toBe(200)
	expect(publicationSchema.parse(await removal.json()).state).toBe('unpublished')
	expect(records.size).toBe(0)
})
