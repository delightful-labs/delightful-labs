import type { RequestHandler } from './$types'
import { configuredAuth } from '../../../../lib/server/auth/handler.js'
import { authConfiguration } from '../../../../lib/server/auth/server.js'
import { jazz } from '../../../../lib/server/jazz.js'
import { handlePublicationSubmit } from '../../../../lib/server/publication/submit.js'
import { publicationFailure } from '../../../../lib/server/publication/http.js'

export const POST: RequestHandler = async ({ request }) => {
	try {
		const config = authConfiguration.safeParse({
			origin: process.env.AUTH_BASE_URL,
			secret: process.env.AUTH_SECRET
		})
		const auth = config.success ? configuredAuth() : undefined
		if (!auth || !config.success) return publicationFailure(503)
		return await handlePublicationSubmit(auth, jazz, request, config.data.origin)
	} catch {
		request.signal.throwIfAborted()
		return publicationFailure(503)
	}
}
