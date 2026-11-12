import { expect, it } from 'vitest'
import { articleSchema } from './article-schema.js'
import { fixtureAttachment } from './fixtures.test-support.js'
it('owns Article metadata, content and capture evidence independently of Document state', () => {
	const article = fixtureAttachment({
		author: 'Ada',
		publishedAt: '2026-11-12',
		language: 'en',
		source: {
			resolvedUrl: 'https://example.com/resolved',
			canonicalUrl: 'https://publisher.example/canonical'
		}
	})
	expect(articleSchema.parse(article)).toEqual(article)
	expect(article).not.toHaveProperty('status')
	expect(article).not.toHaveProperty('readingProgress')
	expect(article).not.toHaveProperty('kind')
})
it('validates reusable Site and favicon relationships', () => {
	const id = crypto.randomUUID()
	const article = fixtureAttachment({
		site: {
			id,
			origin: 'https://news.example.com',
			name: 'News',
			favicon: {
				id,
				libraryId: id,
				operationId: id,
				mediaType: 'image/png',
				payload: new Uint8Array([1])
			}
		}
	})
	expect(articleSchema.parse(article)).toEqual(article)
	expect(
		articleSchema.safeParse({
			...article,
			site: { ...article.site, origin: 'https://news.example.com/path' }
		}).success
	).toBe(false)
	expect(
		articleSchema.safeParse({
			...article,
			source: { resolvedUrl: 'file:///private', canonicalUrl: null }
		}).success
	).toBe(false)
})
