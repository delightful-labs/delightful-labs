import type { CaptureDocument } from '../contracts/articles.js'
import type { PreparedSave } from '../contracts/storage.js'
type SaveTarget = Pick<PreparedSave, 'documentId' | 'source'>

export function isPendingArticle(
	article: CaptureDocument | null | undefined
): article is CaptureDocument {
	return article != null && article.attachment === null
}

function isPendingArticleForSource(
	article: CaptureDocument | null,
	source: SaveTarget['source']
): article is CaptureDocument {
	return isPendingArticle(article) && article.sourceUrl === (source?.submittedUrl ?? null)
}

/** A new intent may create an article or bind a matching, unreserved pending article. */
export function canBindArticleIntent(article: CaptureDocument | null, target: SaveTarget) {
	if (article === null) return true
	return (
		article.id === target.documentId &&
		isPendingArticleForSource(article, target.source) &&
		article.operationId === null
	)
}

/** Publication must complete the pending article already bound to this exact operation. */
export function canPublishArticleContent(
	article: CaptureDocument | null,
	target: SaveTarget,
	operationId: string
) {
	return (
		article !== null &&
		article.id === target.documentId &&
		isPendingArticleForSource(article, target.source) &&
		article.operationId === operationId
	)
}

export function canAttachArticleContent(
	article: CaptureDocument | null,
	contentAvailable: boolean
) {
	if (!contentAvailable) return false
	if (article === null) return true
	return isPendingArticle(article)
}
