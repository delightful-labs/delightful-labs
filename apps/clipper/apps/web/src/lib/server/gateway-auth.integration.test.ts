import { extensionOrigin } from '../../../../../tooling/extension-identity.js'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import {
	acceptDeviceAccounts,
	createJazz,
	createJazzClient,
	remote,
	memory
} from 'jazz-tools/backend'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { app } from '../backend/jazz/jazz.generated.js'
import permissions from '../backend/jazz/jazz.permissions.json' with { type: 'json' }
import { authenticateGateway } from './gateway-auth.js'

// Test-only use of the SDK's own minter: never custom signing or verification.
const sdk = dirname(createRequire(import.meta.url).resolve('jazz-tools'))
const {
	mintLocalFirstTokenFromSeed
}: {
	mintLocalFirstTokenFromSeed(seed: string, scope: string, ttl: number, now?: number): string
} = await import(pathToFileURL(join(sdk, 'runtime/local-first-token.js')).href)
const { authSecretSeedForMinting }: { authSecretSeedForMinting(secret: string): string } =
	await import(pathToFileURL(join(sdk, 'runtime/auth-secret-codec.js')).href)
let core: Awaited<ReturnType<typeof startLocalJazzServer>>
let backend: ReturnType<typeof createJazz>
const server = createServer((request, response) => backend.nodeHandler(request, response))
const clients: Awaited<ReturnType<typeof createJazzClient>>[] = []
let endpoint: string

beforeAll(async () => {
	core = await startLocalJazzServer({
		inMemory: true
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('Missing isolated listener')
	endpoint = `http://127.0.0.1:${address.port}/jazz`
	backend = createJazz({
		app,
		permissions,
		store: remote({ url: core.url, appId: core.appId, secret: core.adminSecret }),
		authenticate: acceptDeviceAccounts,
		publicUrl: endpoint,
		allowedOrigins: [extensionOrigin]
	})
	await backend.attach(server)
	await backend.ready()
}, 30000)
afterAll(async () => {
	for (const client of clients) await client.close({ timeoutMs: 0 })
	await backend?.close()
	server.closeAllConnections()
	await new Promise<void>((resolve) => server.close(() => resolve()))
	await core?.stop()
})
async function guest() {
	let stored: string | null = null
	const client = await createJazzClient({
		serverUrl: endpoint,
		app,
		permissions,
		initial: 'device',
		driver: { type: 'memory' },
		store: {
			read: async () => stored,
			update: async (transform) => {
				stored = transform(stored)
			}
		}
	})
	clients.push(client)
	const { user, client: binding } = client.getSnapshot()
	if (!user || !binding) throw new Error('Guest not ready')
	await binding.db
		.insert(
			app.libraries,
			{ ownerId: user.accountId, bootstrapVersion: '1' },
			{ id: user.accountId }
		)
		.wait({ tier: 'global' })
	const seed = authSecretSeedForMinting(client.exportDeviceKey())
	return { user, db: binding.db, seed, client }
}
function request(token?: string, headers: Record<string, string> = {}) {
	return new Request(`${endpoint.replace('/jazz', '')}/api/capture/resolve`, {
		headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }
	})
}
async function admission(token?: string, headers?: Record<string, string>) {
	const result = await authenticateGateway(request(token, headers), backend)
	return result instanceof Response ? result.status : 200
}

it('admits signed registered guests and enforces private data policies', async () => {
	const owner = await guest(),
		stranger = await guest()
	const token = mintLocalFirstTokenFromSeed(owner.seed, endpoint, 300)
	const db = owner.db
	expect(await admission(token)).toBe(200)
	expect(await backend.accountFor(request(token))).toBe(owner.user.accountId)
	await expect(backend.forReqUser(request(token))).rejects.toThrow()
	expect(
		(await db.one(app.libraries.where({ id: owner.user.accountId }), { tier: 'remote' }))?.id
	).toBe(owner.user.accountId)
	expect(
		await db.one(app.libraries.where({ id: stranger.user.accountId }), { tier: 'remote' })
	).toBeNull()
	await expect(
		db
			.upsert(app.libraries, stranger.user.accountId, {
				ownerId: stranger.user.accountId,
				bootstrapVersion: '1'
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
})
it('rejects absent, malformed, tampered, expired, foreign and unregistered proofs', async () => {
	const owner = await guest()
	const token = mintLocalFirstTokenFromSeed(owner.seed, endpoint, 300)
	const parts = token.split('.')
	parts[2] = `${parts[2]?.startsWith('A') ? 'B' : 'A'}${parts[2]?.slice(1)}`
	const outcomes = await Promise.all([
		admission(),
		admission('invalid'),
		admission(parts.join('.')),
		admission(
			mintLocalFirstTokenFromSeed(owner.seed, endpoint, 1, Math.floor(Date.now() / 1000) - 120)
		),
		admission(mintLocalFirstTokenFromSeed(owner.seed, 'https://foreign.invalid/jazz', 300), {
			host: 'foreign.invalid',
			'x-forwarded-host': 'foreign.invalid',
			'x-forwarded-proto': 'https'
		}),
		admission(mintLocalFirstTokenFromSeed(randomBytes(32).toString('base64url'), endpoint, 300))
	])
	// Only status codes enter assertions: never include identity secrets or JWTs.
	expect(outcomes).toEqual([401, 401, 401, 401, 401, 401])
})
it('allows the configured extension transport and refuses unlisted browser origins', async () => {
	const owner = await guest()
	const token = mintLocalFirstTokenFromSeed(owner.seed, endpoint, 300)
	expect(await admission(token, { origin: extensionOrigin })).toBe(200)
	const originResponse = (origin: string) =>
		backend.handle(
			new Request(`${endpoint}/apps/${core.appId}/accounts/backend-user`, {
				method: 'POST',
				headers: { origin }
			})
		)
	// Native alpha.66 reports a signed-out identity as 200 with no identity.
	// Transport admission does not authenticate a backend user.
	const configured = await originResponse(extensionOrigin)
	expect(configured.status).toBe(200)
	expect(await configured.json()).toEqual({ user: null })
	expect((await originResponse('chrome-extension://' + 'a'.repeat(32))).status).toBe(403)
	expect((await originResponse('null')).status).toBe(403)
	expect((await originResponse('https://foreign.invalid')).status).toBe(403)
})

it.each([
	'null',
	'file:///tmp/clipper',
	'chrome-extension://*',
	'chrome-extension://' + 'a'.repeat(32) + '/unexpected'
])('refuses unsafe origin configuration: %s', (origin) => {
	expect(() => createJazz({ app, permissions, store: memory(), allowedOrigins: [origin] })).toThrow(
		/allowedOrigins/
	)
})
it('rechecks registry admission after a guest key is revoked', async () => {
	const owner = await guest()
	const token = mintLocalFirstTokenFromSeed(owner.seed, endpoint, 300)
	expect(await admission(token)).toBe(200)
	await owner.client.close({ timeoutMs: 0 })
	const identity = owner.user.identity
	const response = await fetch(`${core.url}/apps/${core.appId}/admin/accounts/revoke`, {
		method: 'POST',
		headers: { 'X-Jazz-Admin-Secret': core.adminSecret, 'Content-Type': 'application/json' },
		body: JSON.stringify({ approver: identity, target: identity })
	})
	expect(response.status).toBe(204)
	expect(await admission(token)).toBe(401)
})
