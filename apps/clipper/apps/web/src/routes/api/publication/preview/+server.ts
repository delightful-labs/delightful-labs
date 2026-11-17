import type { RequestHandler } from './$types'
import { configuredAuth } from '../../../../lib/server/auth/handler.js'
import { authConfiguration } from '../../../../lib/server/auth/server.js'
import { jazz } from '../../../../lib/server/jazz.js'
import { handlePreviewRequest } from '../../../../lib/server/publication/request.js'

const unavailable = () =>
	new Response(null, {
		status: 503,
		headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
	})
export const POST: RequestHandler = async ({ request }) => {
	try {
		const config = authConfiguration.safeParse({
			origin: process.env.AUTH_BASE_URL,
			secret: process.env.AUTH_SECRET
		})
		const auth = config.success ? configuredAuth() : undefined
		if (!auth || !config.success) return unavailable()
		return await handlePreviewRequest(auth, jazz, request, config.data.origin)
	} catch {
		request.signal.throwIfAborted()
		return unavailable()
	}
}
