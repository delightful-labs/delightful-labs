import {
	authConfiguration,
	createAtprotoAuthServer
} from 'delightful-local-first/backend/jazz/auth'
import { createAuthRequestHandler } from 'delightful-local-first/auth/atproto/server'
import { app } from '../jazz.generated.js'
import { createLogger } from '../diagnostics/logger.js'

const logger = createLogger('auth')

const handleConfiguredAuth = createAuthRequestHandler({
	cookieName: 'finance.oauth-completion',
	callbackRoute: '/'
})
let auth: ReturnType<typeof createAtprotoAuthServer> | undefined
const configuration = () =>
	authConfiguration.safeParse({
		origin: process.env.AUTH_BASE_URL,
		secret: process.env.AUTH_SECRET
	})

/** The shared adapter acquires Finance's existing backend lazily, avoiding a startup cycle. */
export function configuredAuth(): ReturnType<typeof createAtprotoAuthServer> | undefined {
	const parsed = configuration()
	if (!parsed.success) return undefined
	return (auth ??= createAtprotoAuthServer(
		{ db: async () => (await import('./jazz.js')).jazz.db, schema: app },
		parsed.data,
		{ clientName: 'Delightful Finance', cookiePrefix: 'finance.auth' }
	))
}
function unavailable(error: string, status = 503) {
	return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}
export async function handleAuth(request: Request): Promise<Response> {
	const parsed = configuration()
	if (!parsed.success) return unavailable('invalid_auth_configuration')
	let configured: ReturnType<typeof configuredAuth>
	try {
		configured = configuredAuth()
	} catch {
		return unavailable('auth_initialization_failed', 500)
	}
	if (!configured) return unavailable('invalid_auth_configuration')
	try {
		return await handleConfiguredAuth(
			{
				api: configured.api,
				handler: async (providerRequest) => {
					try {
						return await configured.handler(providerRequest)
					} catch (error) {
						const kind =
							error instanceof Error &&
							['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'].includes(
								error.name
							)
								? error.name
								: 'unknown'
						const frame =
							error instanceof Error
								? error.stack?.match(/\/var\/task\/([A-Za-z0-9_./-]+):(\d+):(\d+)/)
								: undefined
						logger.error('provider_request_failed', {
							kind,
							location: frame ? frame.slice(1).join(':') : 'unavailable'
						})
						throw error
					}
				}
			},
			request,
			parsed.data
		)
	} catch {
		if (request.signal.aborted)
			throw new DOMException('Authentication request disconnected', 'AbortError')
		return unavailable('auth_request_failed', 500)
	}
}
