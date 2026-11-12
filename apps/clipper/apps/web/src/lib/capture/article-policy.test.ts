import { fixtureDocument, fixtureAttachment } from './fixtures.test-support.js'
import { expect, it } from 'vitest'
import type { CaptureDocument } from '../contracts/articles.js'
import type { PreparedSave } from '../contracts/storage.js'
import {
	canAttachArticleContent,
	canBindArticleIntent,
	canPublishArticleContent,
	isPendingArticle
} from './article-policy.js'
const pending: CaptureDocument = fixtureDocument({
	readingProgress: 0,
	resumePosition: null,
	favorite: false,
	status: 'inbox',
	id: 'article',
	libraryId: 'library',
	sourceUrl: 'https://example.com/',
	createdAt: new Date('2026-11-04'),
	attachment: null,
	operationId: null,
	failure: null
})
const target: Pick<PreparedSave, 'documentId' | 'source'> = {
	documentId: pending.id,
	source: {
		finalUrl: pending.sourceUrl ?? 'https://example.com/',
		submittedUrl: pending.sourceUrl ?? 'https://example.com/',
		provenance: '{}'
	}
}
it.each([
	{ article: null, bind: true, publish: false },
	{ article: pending, bind: true, publish: false },
	{ article: { ...pending, operationId: 'operation' }, bind: false, publish: true },
	{ article: { ...pending, operationId: 'other' }, bind: false, publish: false },
	{ article: { ...pending, sourceUrl: 'https://other.example/' }, bind: false, publish: false },
	{
		article: { ...pending, attachment: fixtureAttachment(), operationId: 'operation' },
		bind: false,
		publish: false
	}
])('checks binding and publication independently for $article', ({ article, bind, publish }) => {
	expect(canBindArticleIntent(article, target)).toBe(bind)
	expect(canPublishArticleContent(article, target, 'operation')).toBe(publish)
})
it('allows a direct save without a source only when its Document also has no web source', () => {
	const target = { documentId: pending.id }
	expect(canBindArticleIntent(null, target)).toBe(true)
	expect(canBindArticleIntent(pending, target)).toBe(false)
	const direct = fixtureDocument({ id: pending.id, sourceUrl: null })
	expect(canBindArticleIntent(direct, target)).toBe(true)
	expect(
		canPublishArticleContent({ ...direct, operationId: 'operation' }, target, 'operation')
	).toBe(true)
})
it('requires available content and preserves completed articles during attachment', () => {
	expect(canAttachArticleContent(null, true)).toBe(true)
	expect(canAttachArticleContent(pending, true)).toBe(true)
	expect(canAttachArticleContent(pending, false)).toBe(false)
	expect(canAttachArticleContent(null, false)).toBe(false)
	expect(canAttachArticleContent({ ...pending, attachment: fixtureAttachment() }, true)).toBe(false)
	expect(isPendingArticle(null)).toBe(false)
	expect(isPendingArticle(undefined)).toBe(false)
})
