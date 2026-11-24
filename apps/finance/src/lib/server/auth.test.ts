import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJazz, memory, sqlite, type Jazz } from 'jazz-tools/backend'
import {
	createAtprotoAuthServer,
	createJazzAuthHandlers
} from 'delightful-local-first/backend/jazz/auth'
import { z } from 'zod'
import { makeSignature } from 'better-auth/crypto'
import { app } from '../jazz.generated.js'
import { app as baseline } from './fixtures/pre-auth.generated.js'
import baselinePermissions from './fixtures/pre-auth.permissions.json' with { type: 'json' }
import permissions from '../jazz.permissions.json' with { type: 'json' }
import { handleAuth } from './auth.js'
import { createPolicyTestApp, type PolicyTestSession } from 'jazz-tools/testing'

afterEach(() => vi.unstubAllEnvs())

it('keeps native authentication records private from both guest and external Finance sessions', async () => {
	const fixture = await createPolicyTestApp(app, permissions, expect)
	const userId = crypto.randomUUID(),
		stateId = crypto.randomUUID()
	const now = new Date(),
		expiresAt = new Date(Date.now() + 600_000)
	try {
		await fixture.seed((db) =>
			db.insert(
				app.better_auth_user,
				{
					name: 'Private user',
					email: 'private@example.invalid',
					emailVerified: true,
					createdAt: now,
					updatedAt: now
				},
				{ id: userId }
			)
		)
		await fixture.seed((db) =>
			db.insert(app.better_auth_session, {
				userId,
				token: 'private-session',
				expiresAt,
				createdAt: now,
				updatedAt: now
			})
		)
		await fixture.seed((db) =>
			db.insert(app.better_auth_account, {
				userId,
				accountId: 'private-provider-account',
				providerId: 'atproto',
				accessToken: 'private-access-token',
				createdAt: now,
				updatedAt: now
			})
		)
		await fixture.seed((db) =>
			db.insert(app.better_auth_verification, {
				identifier: 'private-identifier',
				value: 'private-verification',
				createdAt: now,
				updatedAt: now,
				expiresAt
			})
		)
		await fixture.seed((db) =>
			db.insert(app.better_auth_atprotoSession, {
				userId,
				did: 'did:plc:private',
				handle: 'private.invalid',
				pdsUrl: 'https://pds.invalid',
				sessionData: 'private-provider-session',
				updatedAt: now
			})
		)
		await fixture.seed((db) =>
			db.insert(
				app.better_auth_atprotoState,
				{
					stateKey: 'private-state',
					stateData: 'private-state-data',
					expiresAt
				},
				{ id: stateId }
			)
		)
		const sessions: PolicyTestSession[] = [
			{ user_id: 'finance-auth-guest', authMode: 'device-account', claims: {} },
			{ user_id: userId, issuer: 'https://finance.invalid', authMode: 'external', claims: {} }
		]
		for (const session of sessions) {
			const db = fixture.as(session)
			expect(await db.all(app.better_auth_user)).toEqual([])
			expect(await db.all(app.better_auth_session)).toEqual([])
			expect(await db.all(app.better_auth_account)).toEqual([])
			expect(await db.all(app.better_auth_verification)).toEqual([])
			expect(await db.all(app.better_auth_atprotoSession)).toEqual([])
			expect(await db.all(app.better_auth_atprotoState)).toEqual([])
			await db.expectDenied((client) =>
				client.update(app.better_auth_user, userId, { name: 'Changed' })
			)
			await db.expectDenied((client) => client.delete(app.better_auth_atprotoState, stateId))
			await db.expectDenied((client) =>
				client.insert(app.better_auth_atprotoState, {
					stateKey: 'forged',
					stateData: 'forged',
					expiresAt
				})
			)
		}
	} finally {
		await fixture.shutdown()
	}
})

it('refuses unconfigured auth without exposing configuration values', async () => {
	vi.stubEnv('AUTH_BASE_URL', 'private-invalid-origin')
	vi.stubEnv('AUTH_SECRET', 'private-invalid-secret')
	const response = await handleAuth(new Request('https://finance.invalid/api/auth/get-session'))
	expect(response.status).toBe(503)
	expect(response.headers.get('cache-control')).toBe('no-store')
	expect(await response.json()).toEqual({ error: 'invalid_auth_configuration' })
})

it('adds auth to a persisted pre-auth Finance store without changing its ledger or identity', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'finance-atproto-migration-'))
	vi.stubEnv('JAZZ_APP_DIR', fileURLToPath(new URL('./fixtures/', import.meta.url)))
	let backend: Jazz = createJazz({
		app: baseline,
		permissions: baselinePermissions,
		store: sqlite({ path: directory })
	})
	const organizationId = crypto.randomUUID(),
		ownerId = crypto.randomUUID()
	const accountId = crypto.randomUUID(),
		categoryId = crypto.randomUUID(),
		transactionId = crypto.randomUUID()
	try {
		await backend.db
			.insert(
				app.organizations,
				{
					name: 'Existing workspace',
					kind: 'personal',
					defaultCurrency: 'USD',
					ownerId
				},
				{ id: organizationId }
			)
			.wait({ tier: 'global' })
		await backend.db
			.insert(
				app.accounts,
				{
					organizationId,
					name: 'Existing account',
					kind: 'bank',
					currency: 'USD'
				},
				{ id: accountId }
			)
			.wait({ tier: 'global' })
		await backend.db
			.insert(
				app.categories,
				{
					organizationId,
					name: 'Existing category',
					kind: 'expense',
					isSystem: false
				},
				{ id: categoryId }
			)
			.wait({ tier: 'global' })
		await backend.db
			.insert(
				app.transactions,
				{
					organizationId,
					accountId,
					categoryId,
					amountMinor: 1234,
					kind: 'expense',
					currency: 'USD',
					bookedOn: '2026-11-19',
					source: 'manual'
				},
				{ id: transactionId }
			)
			.wait({ tier: 'global' })
		const before = await backend.db.all(app.transactions)
		const appId = backend.appId
		await backend.close()
		vi.stubEnv('JAZZ_APP_DIR', fileURLToPath(new URL('../', import.meta.url)))
		backend = createJazz({ app, permissions, store: sqlite({ path: directory }) })
		expect(await backend.db.all(app.transactions)).toEqual(before)
		expect(backend.appId).toBe(appId)
		expect(await backend.db.one(app.organizations.where({ id: organizationId }))).toMatchObject({
			ownerId,
			name: 'Existing workspace'
		})
		const origin = 'https://finance.invalid',
			secret = 'finance-test-secret-at-least-thirty-two-characters'
		const auth = createAtprotoAuthServer(
			{ db: () => backend.db, schema: app },
			{ origin, secret },
			{
				clientName: 'Delightful Finance',
				cookiePrefix: 'finance.auth'
			}
		)
		const context = await auth.$context
		const user = await context.internalAdapter.createUser(
			{
				name: 'Finance user',
				email: 'fixture@example.invalid',
				emailVerified: true
			},
			{
				method: 'oauth',
				oauth: { providerId: 'atproto', profile: { did: 'did:plc:finance-fixture' } }
			}
		)
		const session = await context.internalAdapter.createSession(user.id)
		expect(context.authCookies.sessionToken.name).toContain('finance.auth.')
		const cookie =
			context.authCookies.sessionToken.name +
			'=' +
			encodeURIComponent(session.token + '.' + (await makeSignature(session.token, secret)))
		await backend.close()
		backend = createJazz({ app, permissions, store: sqlite({ path: directory }) })
		const reopened = createAtprotoAuthServer(
			{ db: () => backend.db, schema: app },
			{ origin, secret },
			{
				clientName: 'Delightful Finance',
				cookiePrefix: 'finance.auth'
			}
		)
		const result = await reopened.api.getSession({ headers: new Headers({ cookie }) })
		expect(result?.user.id).toBe(user.id)
		expect(await backend.db.all(app.transactions)).toEqual(before)
	} finally {
		await backend.close()
		await rm(directory, { recursive: true, force: true })
	}
})

it('renews native backend sessions without mutating admission and rejects revoked or expired credentials', async () => {
	const origin = 'https://finance.invalid',
		secret = 'finance-native-session-secret-at-least-thirty-two'
	let auth: ReturnType<typeof createAtprotoAuthServer>
	const backend = createJazz({
		app,
		permissions,
		store: memory(),
		...createJazzAuthHandlers(() => auth)
	})
	auth = createAtprotoAuthServer(
		{ db: () => backend.db, schema: app },
		{ origin, secret },
		{ clientName: 'Delightful Finance', cookiePrefix: 'finance.auth' }
	)
	try {
		const context = await auth.$context
		const user = await context.internalAdapter.createUser(
			{ name: 'Session fixture', email: 'session@example.invalid', emailVerified: true },
			{ method: 'oauth', oauth: { providerId: 'atproto', profile: { did: 'did:plc:session' } } }
		)
		const session = await context.internalAdapter.createSession(user.id)
		const headers = new Headers({
			origin,
			cookie:
				context.authCookies.sessionToken.name +
				'=' +
				encodeURIComponent(session.token + '.' + (await makeSignature(session.token, secret)))
		})
		const request = () => new Request(origin + '/jazz', { headers })
		const accountId = await backend.createAccountFor(user.id)
		const due = new Date(Date.now() + 300_000)
		await backend.db
			.update(app.better_auth_session, session.id, { expiresAt: due })
			.wait({ tier: 'global' })
		expect(await backend.accountFor(request())).toBe(accountId)
		expect(
			(await backend.db.one(app.better_auth_session.where({ id: session.id })))?.expiresAt
		).toEqual(due)
		const refreshed = await backend.handle(
			new Request(`${origin}/jazz/apps/${backend.appId}/accounts/backend-user`, {
				method: 'POST',
				headers
			})
		)
		expect(refreshed.status).toBe(200)
		const identity = z
			.object({ identity: z.object({ subject: z.string() }) })
			.parse(await refreshed.json())
		expect(identity.identity.subject).toBe(user.id)
		expect(refreshed.headers.getSetCookie().length).toBeGreaterThan(0)
		expect(
			(await backend.db.one(app.better_auth_session.where({ id: session.id })))?.expiresAt.getTime()
		).toBeGreaterThan(due.getTime())
		expect(await backend.accountFor(request())).toBe(accountId)
		const revoked = await auth.handler(
			new Request(origin + '/api/auth/revoke-session', {
				method: 'POST',
				headers: new Headers([...headers, ['Content-Type', 'application/json']]),
				body: JSON.stringify({ token: session.token })
			})
		)
		expect(revoked.status).toBe(200)
		await revoked.body?.cancel()
		expect(await backend.accountFor(request())).toBeNull()
		const expired = await context.internalAdapter.createSession(user.id)
		headers.set(
			'cookie',
			context.authCookies.sessionToken.name +
				'=' +
				encodeURIComponent(expired.token + '.' + (await makeSignature(expired.token, secret)))
		)
		await backend.db
			.update(app.better_auth_session, expired.id, { expiresAt: new Date(Date.now() - 60_000) })
			.wait({ tier: 'global' })
		expect(await backend.accountFor(request())).toBeNull()
		expect(await backend.createAccountFor(user.id)).toBe(accountId)
	} finally {
		await backend.close()
	}
})

it('serves identity-only Finance metadata through the application auth boundary', async () => {
	const origin = 'https://finance-preview.example.invalid'
	vi.stubEnv('AUTH_BASE_URL', origin)
	vi.stubEnv('AUTH_SECRET', 'disposable-metadata-fixture-secret-longer-than-thirty-two')
	const response = await handleAuth(
		new Request(origin + '/api/auth/oauth-client-metadata.json', {
			headers: { 'x-forwarded-for': '192.0.2.1' }
		})
	)
	expect(response.status).toBe(200)
	expect(await response.json()).toMatchObject({
		client_id: origin + '/api/auth/oauth-client-metadata.json',
		client_name: 'Delightful Finance',
		scope: 'atproto',
		redirect_uris: [origin + '/api/auth/atproto/callback']
	})
})
