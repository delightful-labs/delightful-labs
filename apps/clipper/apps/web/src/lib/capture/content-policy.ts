import type { CaptureDocument } from '../contracts/articles.js'
import type { PreparedSave, StorageIntent } from '../contracts/storage.js'
import { canBindArticleIntent, canPublishArticleContent } from './article-policy.js'

export type ContentFacts = {
	draft: PreparedSave
	operationId: string
	intent: StorageIntent | null
	article: CaptureDocument | null
}
export function canBindStorageIntent(facts: ContentFacts) {
	return facts.intent === null && canBindArticleIntent(facts.article, facts.draft)
}
export function canPublishStoredContent(facts: ContentFacts) {
	return (
		facts.intent?.payloadHash === facts.draft.intent.payloadHash &&
		canPublishArticleContent(facts.article, facts.draft, facts.operationId)
	)
}
export function hasExistingArticle(facts: { article: CaptureDocument | null }) {
	return facts.article !== null
}
