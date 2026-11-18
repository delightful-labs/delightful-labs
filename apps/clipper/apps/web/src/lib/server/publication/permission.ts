import { z } from 'zod'
import { didSchema } from '../../annotations/publication-link.js'

// The plugin publishes a broad BetterAuthPlugin declaration. Narrow its actual
// server-only capability at this boundary without changing vendor declarations,
// starting another OAuth client or accepting native handles from HTTP input.
export function hasRestorer(value: unknown): value is {
	getAtprotoClient: (input: { body: { did: string } }) => Promise<unknown>
} {
	return (
		typeof value === 'object' &&
		value !== null &&
		'getAtprotoClient' in value &&
		typeof value.getAtprotoClient === 'function'
	)
}
/** Inspect the SDK's existing TokenInfo fields, never access/refresh tokens.
 * Recognize the full collection permission Clipper requests; do not infer grants
 * from client metadata, linked-account scope, prefixes or legacy broad scopes. */
export function permitsPublication(value: unknown, did: string, observedAt: number) {
	if (typeof value !== 'object' || value === null) return false
	if (!('sub' in value) || value.sub !== did || !didSchema.safeParse(value.sub).success)
		return false
	if (!('scope' in value) || typeof value.scope !== 'string') return false
	const scopes = value.scope.split(' ')
	if (!scopes.includes('atproto') || !scopes.includes('repo:at.margin.note')) return false
	if ('expired' in value && value.expired !== undefined && value.expired !== false) return false
	if ('expiresAt' in value && value.expiresAt !== undefined) {
		const expiration = z.date().safeParse(value.expiresAt)
		if (!expiration.success || expiration.data.getTime() <= observedAt) return false
	}
	return true
}
