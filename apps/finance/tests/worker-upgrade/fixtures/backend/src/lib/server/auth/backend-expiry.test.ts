import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { makeSignature } from 'better-auth/crypto'
import { z } from 'zod'
import { app } from '../../backend/jazz/jazz.generated.js'

const origin = 'https://example.invalid'
const secret = 'native-jazz-auth-expiry-proof-longer-than-32'
let backend: import('jazz-tools/backend').Jazz | undefined
beforeAll(() => {
	vi.stubEnv('VERCEL', '')
	vi.stubEnv('CLIPPER_TEST', 'false')
	vi.stubEnv('CLIPPER_EPHEMERAL_JAZZ', 'true')
	vi.stubEnv('AUTH_BASE_URL', origin)
	vi.stubEnv('AUTH_SECRET', secret)
})
afterAll(async () => {
	await backend?.close()
	vi.unstubAllEnvs()
})

it('keeps native Jazz admission read-only and renews Better Auth through the SDK refresh hook', async () => {
	const { jazz } = await import('../jazz.js')
	backend = jazz
	await jazz.ready()
	const { configuredAuth } = await import('./handler.js')
	const auth = configuredAuth()
	if (!auth) throw new Error('Missing native fixture auth configuration')
	const context = await auth.$context
	const user = await context.internalAdapter.createUser(
		{ name: 'Backend expiry fixture', email: 'expiry@example.invalid', emailVerified: true },
		{ method: 'oauth', oauth: { providerId: 'atproto', profile: { did: 'did:plc:expiry' } } }
	)
	const session = await context.internalAdapter.createSession(user.id)
	const cookie =
		context.authCookies.sessionToken.name +
		'=' +
		encodeURIComponent(session.token + '.' + (await makeSignature(session.token, secret)))
	const headers = { cookie, origin, 'Content-Type': 'application/json' }
	const request = () => new Request(origin + '/api/capture/resolve', { headers })
	const accountId = await jazz.createAccountFor(user.id)
	const due = new Date(Date.now() + 300_123)
	await jazz.db
		.update(app.better_auth_session, session.id, { expiresAt: due })
		.wait({ tier: 'global' })
	expect(await jazz.accountFor(request())).toBe(accountId)
	const before = await jazz.db.one(app.better_auth_session.where({ id: session.id }))
	expect(before?.expiresAt.getTime()).toBe(due.getTime())
	const refreshed = await jazz.handle(
		new Request(`${origin}/jazz/apps/${jazz.appId}/accounts/backend-user`, {
			method: 'POST',
			headers
		})
	)
	expect(refreshed.status).toBe(200)
	const who = z
		.object({ identity: z.object({ subject: z.string() }) })
		.parse(await refreshed.json())
	expect(who.identity.subject === user.id).toBe(true)
	expect(refreshed.headers.getSetCookie().length).toBeGreaterThan(0)
	const renewed = await jazz.db.one(app.better_auth_session.where({ id: session.id }))
	expect(renewed?.expiresAt.getTime()).toBeGreaterThan(due.getTime())
	expect(await jazz.accountFor(request())).toBe(accountId)
	const revoked = await auth.handler(
		new Request(origin + '/api/auth/revoke-session', {
			method: 'POST',
			headers,
			body: JSON.stringify({ token: session.token })
		})
	)
	expect(revoked.status).toBe(200)
	expect(await jazz.accountFor(request())).toBeNull()
})
