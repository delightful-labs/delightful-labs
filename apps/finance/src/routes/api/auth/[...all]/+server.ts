import type { RequestHandler } from './$types'
import { handleAuth } from '#lib/server/auth.js'

export const prerender = false
export const GET: RequestHandler = ({ request }) => handleAuth(request)
export const POST: RequestHandler = ({ request }) => handleAuth(request)
