import { betterAuth } from 'better-auth'
import { atproto } from '@kingironman2011/better-auth-bsky'
import { jazzAdapter } from 'jazz-tools/better-auth-adapter'
import {
	acceptDeviceAccounts,
	type Db,
	type BackendSchemaInput,
	type CreateJazzOptions
} from 'jazz-tools/backend'
import { z } from 'zod'
import { APIError, createAuthMiddleware } from 'better-auth/api'

export const authConfiguration = z.object({
	origin: z
		.url()
		.refine((value) => {
			if (!URL.canParse(value)) return false
			const url = new URL(value)
			return (
				url.pathname === '/' &&
				!url.search &&
				!url.hash &&
				!url.username &&
				!url.password &&
				(url.protocol === 'https:' ||
					(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
			)
		})
		.transform((value) => new URL(value).origin),
	secret: z.string().min(32)
})

export function createAtprotoAuthServer(
	storage: { db: () => Db | Promise<Db>; schema: BackendSchemaInput },
	input: { origin: string; secret: string },
	policy: {
		clientName: string
		cookiePrefix?: string
		authorizationScopes?: readonly string[]
		defaultAuthorizationScope?: string
	}
) {
	const parsed = authConfiguration.safeParse(input)
	if (!parsed.success) throw new Error('Invalid auth server configuration')
	const { origin, secret } = parsed.data
	const configuration = z
		.object({
			clientName: z.string().trim().min(1),
			cookiePrefix: z
				.string()
				.regex(/^[A-Za-z0-9._-]+$/)
				.optional(),
			authorizationScopes: z.array(z.string().trim().min(1)).min(1).default(['atproto']),
			defaultAuthorizationScope: z.string().default('atproto')
		})
		.refine((value) => value.authorizationScopes.includes(value.defaultAuthorizationScope))
		.safeParse(policy)
	if (!configuration.success) throw new Error('Invalid auth authorization policy')
	const { clientName, cookiePrefix, authorizationScopes, defaultAuthorizationScope } =
		configuration.data
	// Exact server-approved grants, not arbitrary scopes supplied by the browser.
	const authorizationInputSchema = z.looseObject({
		scope: z.enum(authorizationScopes).default(defaultAuthorizationScope)
	})
	const scope = [...new Set(authorizationScopes.flatMap((value) => value.split(/\s+/)))].join(' ')
	return betterAuth({
		database: jazzAdapter(storage),
		baseURL: origin,
		basePath: '/api/auth',
		...(cookiePrefix ? { advanced: { cookiePrefix } } : {}),
		secret,
		plugins: [atproto({ clientName, scope })],
		hooks: {
			before: createAuthMiddleware(async (context) => {
				if (context.path !== '/sign-in/atproto') return
				if (
					context.request &&
					(context.request.headers.get('origin') !== origin ||
						new URL(context.request.url).origin !== origin)
				)
					throw APIError.fromStatus('FORBIDDEN')
				const input = authorizationInputSchema.safeParse(context.body)
				if (!input.success) throw APIError.fromStatus('BAD_REQUEST')
				return { context: { body: input.data } }
			})
		}
	})
}

/** Native request hooks. Apps retain ownership of backend/store/environment acquisition. */
export function createJazzAuthHandlers(
	getAuth: () => ReturnType<typeof createAtprotoAuthServer> | undefined
) {
	return {
		authenticate: async (request) => {
			const auth = getAuth()
			const session = auth
				? await auth.api.getSession({
						headers: request.headers,
						query: { disableCookieCache: true, disableRefresh: true }
					})
				: null
			return session
				? {
						userId: session.user.id,
						expiresAt: Math.floor(session.session.expiresAt.getTime() / 1000)
					}
				: acceptDeviceAccounts(request)
		},
		refresh: async (request, next) => {
			const auth = getAuth()
			if (!auth) return next(request)
			const refreshed = await auth.api.getSession({
				headers: request.headers,
				query: { disableCookieCache: true },
				returnHeaders: true
			})
			const response = await next(request)
			for (const cookie of refreshed.headers.getSetCookie())
				response.headers.append('Set-Cookie', cookie)
			return response
		}
	} satisfies Pick<CreateJazzOptions, 'authenticate' | 'refresh'>
}
