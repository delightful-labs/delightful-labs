import { articleMetadataSchema } from './metadata.js'
import { newDocument } from './document-schema.js'
import { lowercaseUuidSchema } from '../validation/values.js'
import { articleId, normalizedSource, sourceIdentityUrl } from './source.js'
import { saveArticleRequestSchema } from '../contracts/articles.js'
import type { CaptureDocument, ArticleDraft, SaveArticleRequest } from '../contracts/articles.js'
export function uuid(value: unknown): string {
	const parsed = lowercaseUuidSchema.safeParse(value)
	if (!parsed.success) throw new Error('invalidRecord')
	return parsed.data
}
export async function prepareArticle(
	libraryId: string,
	value: SaveArticleRequest
): Promise<ArticleDraft> {
	const parsed = saveArticleRequestSchema.safeParse(value)
	if (!parsed.success) throw new Error('invalidInput')
	const request = parsed.data
	normalizedSource(request.url)
	const id = await articleId(libraryId, request.url)
	const target = request.operationId
		? uuid(request.operationId)
		: await articleId(libraryId, request.content?.finalUrl ?? request.url)
	const article: CaptureDocument = {
		...newDocument(id, libraryId, request.url),
		libraryId,
		createdAt: new Date(),
		operationId: null,
		failure: null
	}
	return {
		article,
		target,
		...(request.content
			? {
					content: {
						documentId: id,
						operationId: target,
						title: request.content.title,
						...articleMetadataSchema.parse(request.content),
						text: request.content.text,
						bytes: new TextEncoder().encode(request.content.html),
						mediaType: 'text/html',
						source: {
							submittedUrl: request.url,
							finalUrl: sourceIdentityUrl(request.content.finalUrl),
							provenance: request.content.provenance,
							canonicalUrl: request.content.canonicalUrl ?? null
						}
					}
				}
			: {})
	}
}
