import { articleId } from '../capture/source.js'
import { articleSchema } from '../capture/article-schema.js'
import { prepareImages } from '../images/schema.js'
import { captureDetailsSchema } from '../capture/metadata.js'
import type { PreparedSave, SaveRequest } from '../contracts/storage.js'
export { TEXT_LIMIT, BYTE_LIMIT } from './policy.js'
import { saveRequestSchema } from './policy.js'
const encoder = new TextEncoder()
async function hash(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
/** Domain intent fingerprint for reconciliation; Jazz owns byte storage and integrity. */
export async function prepareSave(libraryId: string, request: SaveRequest): Promise<PreparedSave> {
	const parsed = saveRequestSchema.safeParse(request)
	if (!parsed.success) {
		const sourceOnly = parsed.error.issues.every((issue) => issue.path[0] === 'source')
		throw new Error(sourceOnly ? 'Invalid source metadata' : 'Invalid bounded storage request')
	}
	const { operationId, title, text, mediaType } = parsed.data
	const input = parsed.data
	const excerpt = input.excerpt ?? text
	const details = captureDetailsSchema.parse(input)
	const hasDetails = Object.values(details).some((value) => value !== undefined)
	const payload = new Uint8Array(input.bytes)
	const fingerprintSource = request.source ? { ...request.source } : null
	const payloadHash = await hash(
		encoder.encode(
			// Include capture evidence and bytes in uncertain-operation reconciliation.
			JSON.stringify([
				title,
				text,
				await hash(payload),
				mediaType,
				fingerprintSource,
				...(input.excerpt === undefined ? [] : [excerpt]),
				...(hasDetails ? [details] : [])
			])
		)
	)
	const origin = input.source ? new URL(input.source.finalUrl).origin : null
	const site = origin
		? {
				id: await articleId(libraryId, origin),
				origin,
				name: details.siteName ?? null,
				favicon: null
			}
		: null
	const parsedAttachment = articleSchema.safeParse({
		id: operationId,
		title,
		excerpt: input.excerpt ?? null,
		author: details.author ?? null,
		publishedAt: details.publishedTime ?? null,
		language: details.lang ?? null,
		site,
		source: input.source
			? { resolvedUrl: input.source.finalUrl, canonicalUrl: input.source.canonicalUrl ?? null }
			: null,
		html:
			mediaType === 'text/html' ? new TextDecoder('utf-8', { fatal: true }).decode(payload) : '',
		text
	})
	if (!parsedAttachment.success) throw new Error('Invalid bounded storage request')
	const attachment = parsedAttachment.data
	return {
		attachment,
		images:
			mediaType === 'text/html'
				? await prepareImages(
						libraryId,
						operationId,
						new TextDecoder().decode(payload),
						input.featuredImageUrl
					)
				: [],
		documentId: input.documentId ?? operationId,
		...(input.source ? { source: input.source } : {}),
		intent: { id: operationId, libraryId, payloadHash }
	}
}
