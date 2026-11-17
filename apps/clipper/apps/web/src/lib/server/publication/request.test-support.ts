import { createActor, createAsyncLogic, setup, toPromise, types } from 'xstate'
import { makeSignature } from 'better-auth/crypto'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from '../../backend/jazz/schema.js'
import { createAuthServer } from '../auth/server.js'
import { publicationOwnerFixture } from './owner.test-support.js'

export const origin = 'https://clipper.example.invalid'
const secret = 'publication-preview-fixture-secret-longer-than-32'
type Owner = import('xstate').OutputFrom<typeof publicationOwnerFixture>
const credentials = createAsyncLogic({
	run: async ({ input }: { input: string }) => {
		const token = crypto.randomUUID()
		return {
			sessionId: crypto.randomUUID(),
			accountId: crypto.randomUUID(),
			token,
			createdAt: new Date(),
			expiresAt: new Date(Date.now() + 3_600_000),
			cookie: input + '=' + encodeURIComponent(token + '.' + (await makeSignature(token, secret)))
		}
	}
})
const actors = {
	owner: publicationOwnerFixture,
	auth: createAsyncLogic({
		run: async ({ input }: { input: Owner }) => {
			const auth = createAuthServer({ db: () => input.backend, schema: app }, { origin, secret })
			const context = await auth.$context
			return { auth, cookieName: context.authCookies.sessionToken.name }
		}
	}),
	credentials,
	seed: createAsyncLogic({
		run: ({
			input: { owner, credentials }
		}: {
			input: { owner: Owner; credentials: Credentials }
		}) =>
			Promise.all([
				owner.backend
					.insert(
						app.better_auth_user,
						{
							name: 'Preview fixture',
							email: 'preview@example.invalid',
							emailVerified: false,
							image: null,
							createdAt: credentials.createdAt,
							updatedAt: credentials.createdAt,
							atprotoDid: owner.scope.publishingDid,
							atprotoHandle: 'preview.example.invalid'
						},
						{ id: owner.libraryId }
					)
					.wait({ tier: 'global' }),
				owner.backend
					.insert(
						app.better_auth_account,
						{
							accountId: owner.scope.publishingDid,
							providerId: 'atproto',
							userId: owner.libraryId,
							accessToken: null,
							refreshToken: null,
							idToken: null,
							accessTokenExpiresAt: null,
							refreshTokenExpiresAt: null,
							scope: 'atproto',
							password: null,
							createdAt: credentials.createdAt,
							updatedAt: credentials.createdAt
						},
						{ id: credentials.accountId }
					)
					.wait({ tier: 'global' }),
				owner.backend
					.insert(
						app.better_auth_session,
						{
							token: credentials.token,
							userId: owner.libraryId,
							expiresAt: credentials.expiresAt,
							createdAt: credentials.createdAt,
							updatedAt: credentials.createdAt,
							ipAddress: null,
							userAgent: null
						},
						{ id: credentials.sessionId }
					)
					.wait({ tier: 'global' })
			])
	})
}
type Auth = import('xstate').OutputFrom<typeof actors.auth>
type Credentials = import('xstate').OutputFrom<typeof credentials>
type Input = { fixture: PolicyTestApp; name: string }
type Context = Input & {
	owner: Owner | undefined
	auth: Auth | undefined
	credentials: Credentials | undefined
	error: unknown
}
type Fixture = { owner: Owner; auth: Auth['auth']; credentials: Credentials }

/** Native cookie and auth-row setup is a selected batch, after the existing
 * annotation fixture and signed-cookie acquisition have completed. */
const machine = setup({
	schemas: { input: types<Input>(), context: types<Context>(), output: types<Fixture>() },
	actors,
	states: {
		owner: {},
		auth: { schemas: { context: types<{ owner: Owner }>() } },
		credentials: { schemas: { context: types<{ owner: Owner; auth: Auth }>() } },
		seeding: {
			schemas: { context: types<{ owner: Owner; auth: Auth; credentials: Credentials }>() }
		},
		ready: {
			schemas: { context: types<{ owner: Owner; auth: Auth; credentials: Credentials }>() }
		},
		failed: {}
	}
}).createMachine({
	id: 'publication-request-fixture',
	initial: 'owner',
	context: ({ input }) => ({
		...input,
		owner: undefined,
		auth: undefined,
		credentials: undefined,
		error: undefined
	}),
	states: {
		owner: {
			invoke: {
				src: 'owner',
				input: ({ context }) => ({
					...context,
					publishingDid: 'did:plc:ewvi7nxzyoun6zhxrhs64oiz',
					noteText: 'Private document note',
					withHighlight: false
				}),
				onDone: ({ event }) => ({ target: 'auth', context: { owner: event.output } }),
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		auth: {
			invoke: {
				src: 'auth',
				input: ({ context }) => context.owner,
				onDone: ({ event }) => ({ target: 'credentials', context: { auth: event.output } }),
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		credentials: {
			invoke: {
				src: 'credentials',
				input: ({ context }) => context.auth.cookieName,
				onDone: ({ event }) => ({ target: 'seeding', context: { credentials: event.output } }),
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		seeding: {
			invoke: {
				src: 'seed',
				input: ({ context }) => ({ owner: context.owner, credentials: context.credentials }),
				onDone: { target: 'ready' },
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		ready: {
			type: 'final',
			output: ({ context }) => ({
				owner: context.owner,
				auth: context.auth.auth,
				credentials: context.credentials
			})
		},
		failed: {
			type: 'final',
			output: ({ context }) => {
				throw context.error
			}
		}
	}
})

export function requestFixture(input: Input) {
	const actor = createActor(machine, { input })
	const result = toPromise(actor)
	actor.start()
	return result.finally(() => actor.stop())
}
