import { documentSchema, newDocument } from './document-schema.js'
import type { CaptureDocument } from '../contracts/articles.js'
import type { Article } from './article-schema.js'
const id = 'abcdef01-2345-6789-abcd-ef0123456789'
export function fixtureAttachment(overrides: Partial<Article> = {}): Article {
	return {
		id,
		title: 'Saved title',
		excerpt: null,
		author: null,
		publishedAt: null,
		language: null,
		site: null,
		source: null,
		html: '<p>Saved text</p>',
		text: 'Saved text',
		...overrides
	}
}
export function fixtureDocument(overrides: Partial<CaptureDocument> = {}): CaptureDocument {
	const base = {
		...newDocument(id, id, 'https://example.com/'),
		libraryId: id,
		operationId: null,
		failure: null,
		createdAt: new Date('2026-11-04T00:00:00Z')
	}
	if (overrides.status === 'trashed')
		return {
			...base,
			...overrides,
			status: 'trashed',
			previousStatus: overrides.previousStatus ?? 'inbox'
		}
	return { ...base, ...overrides, status: overrides.status ?? 'inbox' }
}

export function fixtureReaderDocument(
	overrides: Partial<import('./document-schema.js').Document> = {}
) {
	return documentSchema.parse({ ...newDocument(id, id, 'https://example.com/'), ...overrides })
}
