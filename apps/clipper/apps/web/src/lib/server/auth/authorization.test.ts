import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createAuthClient } from 'better-auth/client'
import { betterAuth } from 'better-auth'
import { atproto } from '@kingironman2011/better-auth-bsky'
import { atprotoClient } from '@kingironman2011/better-auth-bsky/client'
import { jazzAdapter } from 'jazz-tools/better-auth-adapter'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import type { Db } from 'jazz-tools'
import { z } from 'zod'
import { app } from '../../backend/jazz/jazz.generated.js'
import permissions from '../../backend/jazz/jazz.permissions.json' with { type: 'json' }
import { createAuthServer } from './server.js'
import { identityAuthorizationScope, publicationAuthorizationScope } from './authorization.js'

const origin = 'https://clipper.example.invalid'
const issuer = 'https://issuer.example.invalid'
const pds = 'https://pds.example.invalid'
const did = 'did:plc:abcdefghijklmnopqrstuvwx'
const secret = 'authorization-proof-secret-longer-than-thirty-two'
let fixture: PolicyTestApp
let db: Db

beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	const libraryId = crypto.randomUUID()
	db = await fixture.seed<Db>((server) => {
		const write = server.upsert(app.libraries, libraryId, {
			ownerId: libraryId,
			bootstrapVersion: '1'
		})
		return {
			value: server,
			wait: async (options) => {
				await write.wait(options)
				return server
			}
		}
	})
})
afterAll(async () => fixture?.shutdown())
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

function provider() {
	const pushed: URLSearchParams[] = []
	const network = vi.fn<typeof fetch>(async (input, init) => {
		const request = new Request(input, init)
		if (request.url === 'https://plc.directory/' + encodeURIComponent(did))
			return Response.json({
				'@context': ['https://www.w3.org/ns/did/v1'],
				id: did,
				alsoKnownAs: ['at://fixture.example.invalid'],
				service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }]
			})
		if (request.url === pds + '/.well-known/oauth-protected-resource')
			return Response.json({ resource: pds, authorization_servers: [issuer] })
		if (request.url === issuer + '/.well-known/oauth-authorization-server')
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
		if (request.url === 'https://fixture.example.invalid/.well-known/atproto-did')
			return new Response(did)
		if (
			request.url ===
			'https://cloudflare-dns.com/dns-query?name=_atproto.fixture.example.invalid&type=TXT'
		)
			return Response.json({ Status: 0, Answer: [{ type: 16, data: '"did=' + did + '"' }] })
		if (request.url === issuer + '/par') {
			expect(request.headers.has('DPoP')).toBe(true)
			const body = new URLSearchParams(await request.text())
			expect(body.get('code_challenge_method')).toBe('S256')
			expect(body.get('code_challenge')).toBeTruthy()
			pushed.push(body)
			return Response.json(
				{ request_uri: 'urn:ietf:params:oauth:request_uri:' + crypto.randomUUID(), expires_in: 90 },
				{ status: 201 }
			)
		}
		throw new Error('Unexpected fixture authorization request')
	})
	vi.stubGlobal('fetch', network)
	return { pushed, network }
}

function signInRequest(scope: unknown, selectedOrigin = origin) {
	return new Request(origin + '/api/auth/sign-in/atproto', {
		method: 'POST',
		headers: { origin: selectedOrigin, 'content-type': 'application/json' },
		body: JSON.stringify({
			handle: did,
			callbackURL: '/?atproto_attempt=' + crypto.randomUUID(),
			scope
		})
	})
}

it('requests Margin access by default and honors explicit scopes through the real client, plugin and OAuth PAR implementation', async () => {
	const remote = provider()
	const auth = createAuthServer({ db: () => db, schema: app }, { origin, secret })
	const client = createAuthClient({
		baseURL: origin,
		plugins: [atprotoClient()],
		fetchOptions: {
			customFetchImpl: (input, init) => {
				const request = new Request(input, init)
				request.headers.set('origin', origin)
				return auth.handler(request)
			}
		}
	})
	const metadata = await auth.handler(new Request(origin + '/api/auth/oauth-client-metadata.json'))
	expect(await metadata.json()).toMatchObject({ scope: publicationAuthorizationScope })
	for (const scope of [undefined, identityAuthorizationScope, publicationAuthorizationScope]) {
		const result = await client.signIn.atproto({
			handle: did,
			callbackURL: '/',
			...(scope === undefined ? {} : { scope })
		})
		expect(result.error).toBeNull()
		const redirect = z.object({ url: z.url(), redirect: z.literal(true) }).parse(result.data)
		expect(new URL(redirect.url).origin).toBe(issuer)
	}
	expect(remote.pushed.map((body) => body.get('scope'))).toEqual([
		'atproto repo:at.margin.note',
		'atproto',
		'atproto repo:at.margin.note'
	])
	expect(await db.all(app.better_auth_atprotoState)).toHaveLength(3)
	expect(await db.all(app.publications)).toEqual([])
})

it('rejects unsupported scopes and foreign origins before provider discovery or saved OAuth state', async () => {
	const remote = provider()
	const auth = createAuthServer({ db: () => db, schema: app }, { origin, secret })
	const before = await db.all(app.better_auth_atprotoState)
	for (const scope of [
		'',
		null,
		3,
		[],
		'repo:*',
		'atproto repo:*',
		'transition:generic',
		'atproto repo:at.margin.note?action=create'
	]) {
		expect((await auth.handler(signInRequest(scope))).status).toBe(400)
	}
	expect(
		(
			await auth.handler(
				signInRequest(publicationAuthorizationScope, 'https://other.example.invalid')
			)
		).status
	).toBe(403)
	const missingOrigin = signInRequest(publicationAuthorizationScope)
	missingOrigin.headers.delete('origin')
	expect((await auth.handler(missingOrigin)).status).toBe(403)
	expect(remote.network).not.toHaveBeenCalled()
	expect(await db.all(app.better_auth_atprotoState)).toEqual(before)
})

it('leaves the declared permission ceiling enforced by the underlying OAuth SDK', async () => {
	const remote = provider()
	vi.spyOn(console, 'error').mockImplementation(() => {})
	const auth = betterAuth({
		database: jazzAdapter({ db: () => db, schema: app }),
		baseURL: origin,
		secret,
		plugins: [atproto({ clientName: 'Identity-only fixture' })]
	})
	const before = await db.all(app.better_auth_atprotoState)
	expect((await auth.handler(signInRequest(publicationAuthorizationScope))).ok).toBe(false)
	expect(remote.network).not.toHaveBeenCalled()
	expect(await db.all(app.better_auth_atprotoState)).toEqual(before)
})

it('keeps the patched plugin identity-only by default even without Clipper middleware', async () => {
	const remote = provider()
	const auth = betterAuth({
		database: jazzAdapter({ db: () => db, schema: app }),
		baseURL: origin,
		secret,
		plugins: [
			atproto({ clientName: 'Explicit-default fixture', scope: publicationAuthorizationScope })
		]
	})
	expect((await auth.handler(signInRequest(undefined))).status).toBe(200)
	expect(remote.pushed.map((body) => body.get('scope'))).toEqual(['atproto'])
})
