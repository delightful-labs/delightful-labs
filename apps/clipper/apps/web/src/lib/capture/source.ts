import {
	resolutionResponseSchema,
	extractionEnvelopeSchema,
	extractedContentSchema
} from '../contracts/capture-response.js'
import { articleMetadataSchema, type ArticleMetadata } from './metadata.js'
import { webUrlSchema, usesHttpProtocol, hasCredentials } from '../validation/values.js'
export function sourceIdentityUrl(value: string) {
	if (value.length > 8192) throw new Error('invalidUrl')
	const url = new URL(value)
	if (!usesHttpProtocol(url) || hasCredentials(url)) throw new Error('invalidUrl')
	return url.href
}
/** Fetch/representation comparisons ignore fragments; saved Document identity does not. */
export function normalizedSource(value: string) {
	const url = new URL(sourceIdentityUrl(value))
	url.hash = ''
	return url.href
}
/** Conservative syntax normalization; meaningful query and fragment differences retain identity. */
export async function articleId(libraryId: string, finalUrl: string) {
	const bytes = new Uint8Array(
		await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(
				JSON.stringify(['clipper.article.1', libraryId, sourceIdentityUrl(finalUrl)])
			)
		)
	)
	bytes[6] = ((bytes[6] ?? 0) & 15) | 128
	bytes[8] = ((bytes[8] ?? 0) & 63) | 128
	const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export type Candidate = ArticleMetadata & {
	id: string
	title: string
	text: string
	html: string
	finalUrl: string
	canonicalUrl?: string | null
	submittedUrl: string
	provenance: string
	imagesMissing: boolean
}
export function resolvedUrl(value: unknown, requestId: string) {
	const parsed = resolutionResponseSchema.safeParse(value)
	if (!parsed.success || parsed.data.operationId !== requestId) throw new Error('invalidResponse')
	return normalizedSource(parsed.data.finalUrl)
}
export function extractedCandidate(
	value: unknown,
	requestId: string,
	submittedUrl: string
): Omit<Candidate, 'id'> {
	const envelope = extractionEnvelopeSchema.safeParse(value)
	if (!envelope.success) throw new Error('invalidResponse')
	const data = envelope.data
	const finalUrl = resolvedUrl(value, requestId)
	const parsed = extractedContentSchema.safeParse(data.candidate)
	if (!parsed.success) throw new Error('sourceTooLarge')
	const candidate = parsed.data
	const provenance = JSON.stringify({
		submittedUrl,
		observation: data.provenance,
		canonicalCandidate: data.canonicalCandidate,
		parserVersion: candidate.parserVersion,
		normalizationVersion: candidate.normalizationVersion,
		partialEvidence: candidate.partialEvidence
	})
	if (provenance.length > 32768) throw new Error('sourceTooLarge')
	return {
		title: candidate.title,
		...articleMetadataSchema.parse(candidate),
		text: candidate.text,
		html: candidate.html,
		finalUrl,
		canonicalUrl: (() => {
			const parsed = webUrlSchema.safeParse(data.canonicalCandidate)
			return parsed.success ? parsed.data : null
		})(),
		submittedUrl,
		provenance,
		imagesMissing:
			!!candidate.featuredImageUrl ||
			(Array.isArray(candidate.assetCandidates) && candidate.assetCandidates.length > 0)
	}
}
