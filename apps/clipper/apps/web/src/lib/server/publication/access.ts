import { z } from 'zod'
import { ReadTier } from 'jazz-tools'
import type { Transaction } from 'jazz-tools'
import type { Jazz } from 'jazz-tools/backend'
import { createAsyncLogic, setup, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { app } from '../../backend/jazz/schema.js'
import { lowercaseUuidSchema } from '../../validation/values.js'
import { didSchema } from '../../annotations/publication-link.js'

export type PublicationAuth = {
	api: {
		getSession: (input: {
			headers: Headers
			query: { disableCookieCache: true; disableRefresh: true }
		}) => Promise<unknown>
	}
}
const sessionSchema = z.object({
	user: z.object({ id: lowercaseUuidSchema, atprotoDid: didSchema }),
	session: z.object({ id: lowercaseUuidSchema, expiresAt: z.date() })
})
type Identity = {
	userId: string
	did: string
	sessionId: string
	expiresAt: number
	observedAt: number
}
export type PublicationAccess = Identity & { accountId: string }
type AccessResult =
	| { kind: 'allowed'; access: PublicationAccess }
	| { kind: 'unauthenticated' | 'failed' }
type Input = { request: Request; expected?: PublicationAccess }
type Context = Input & { identity: Identity | undefined; access: PublicationAccess | undefined }

/** Read-only session/canonical-account verification shared by preview and consent.
 * The parent owns deadlines, cancellation and the domain operation it admits. */
export function createPublicationAccess(
	auth: PublicationAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>
) {
	const actors = {
		session: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: Request
				signal: AbortSignal
			}): Promise<Identity | undefined> => {
				const value = await auth.api.getSession({
					headers: input.headers,
					query: { disableCookieCache: true, disableRefresh: true }
				})
				signal.throwIfAborted()
				const parsed = sessionSchema.safeParse(value)
				return parsed.success
					? {
							userId: parsed.data.user.id,
							did: parsed.data.user.atprotoDid,
							sessionId: parsed.data.session.id,
							expiresAt: parsed.data.session.expiresAt.getTime(),
							observedAt: Date.now()
						}
					: undefined
			}
		}),
		binding: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: { request: Request; identity: Identity }
				signal: AbortSignal
			}) => {
				const [accountId, accounts] = await Promise.all([
					backend.accountFor(input.request),
					backend.db.all(
						app.better_auth_account
							.where({
								userId: input.identity.userId,
								providerId: 'atproto',
								accountId: input.identity.did
							})
							.limit(2),
						{ tier: ReadTier.Remote }
					)
				])
				signal.throwIfAborted()
				return { accountId, linked: accounts.length === 1, observedAt: Date.now() }
			}
		})
	}
	const model = setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<AccessResult>(),
			children: {
				session: types<ActorRefFrom<typeof actors.session>>(),
				binding: types<ActorRefFrom<typeof actors.binding>>()
			}
		},
		actors,
		states: {
			session: {},
			binding: { schemas: { context: types<{ identity: Identity }>() } },
			allowed: { schemas: { context: types<{ access: PublicationAccess }>() } },
			unauthenticated: {},
			failed: {}
		},
		guards: {
			validIdentity: ({ context }: { context: Context }, identity: Identity | undefined) =>
				!!identity &&
				identity.expiresAt > identity.observedAt &&
				(!context.expected ||
					(identity.userId === context.expected.userId &&
						identity.did === context.expected.did &&
						identity.sessionId === context.expected.sessionId))
		}
	})
	return model.createMachine({
		id: 'publication-access',
		initial: 'session',
		context: ({ input }) => ({
			request: input.request,
			...(input.expected ? { expected: { ...input.expected } } : {}),
			identity: undefined,
			access: undefined
		}),
		states: {
			session: {
				invoke: {
					id: 'session',
					src: 'session',
					input: ({ context }) => context.request,
					onDone: (args) =>
						args.guards.validIdentity(args, args.event.output) && args.event.output
							? { target: 'binding', context: { identity: args.event.output } }
							: { target: 'unauthenticated' },
					onError: { target: 'failed' }
				}
			},
			binding: {
				invoke: {
					id: 'binding',
					src: 'binding',
					input: ({ context }) => ({ request: context.request, identity: context.identity }),
					onDone: ({ context, event }) =>
						event.output.linked &&
						event.output.accountId &&
						lowercaseUuidSchema.safeParse(event.output.accountId).success &&
						context.identity.expiresAt > event.output.observedAt &&
						(!context.expected || event.output.accountId === context.expected.accountId)
							? {
									target: 'allowed',
									context: {
										access: {
											...context.identity,
											accountId: event.output.accountId,
											observedAt: event.output.observedAt
										}
									}
								}
							: { target: 'unauthenticated' },
					onError: { target: 'failed' }
				}
			},
			allowed: {
				type: 'final',
				output: ({ context }) => ({ kind: 'allowed', access: context.access })
			},
			unauthenticated: { type: 'final', output: () => ({ kind: 'unauthenticated' }) },
			failed: { type: 'final', output: () => ({ kind: 'failed' }) }
		}
	})
}

/** A related transaction snapshot: invalidation participates in native serializable
 * validation alongside the publication write. This does not check a PDS grant. */
export async function authorizePublicationTransaction(
	tx: Transaction<'serializable'>,
	access: PublicationAccess
) {
	const [session, user, accounts] = await Promise.all([
		tx.one(app.better_auth_session.where({ id: access.sessionId, userId: access.userId }), {
			tier: ReadTier.Remote
		}),
		tx.one(app.better_auth_user.where({ id: access.userId, atprotoDid: access.did }), {
			tier: ReadTier.Remote
		}),
		tx.all(
			app.better_auth_account
				.where({ userId: access.userId, providerId: 'atproto', accountId: access.did })
				.limit(2),
			{ tier: ReadTier.Remote }
		)
	])
	return !!session && session.expiresAt.getTime() > Date.now() && !!user && accounts.length === 1
}
