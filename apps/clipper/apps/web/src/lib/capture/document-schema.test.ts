import { expect, it } from 'vitest'
import { documentSchema } from './document-schema.js'

const id = 'abcdef01-2345-6789-abcd-ef0123456789'
const document = {
	id,
	libraryId: id,
	url: 'https://example.com/article',
	readingProgress: 0,
	resumePosition: null,
	favorite: false,
	title: null,
	author: null,
	publishedAt: null,
	siteName: null,
	language: null,
	finalUrl: null,
	canonicalUrl: null,
	representationId: null,
	status: 'inbox'
} as const

it('accepts a saved Document with required numeric progress and no attachment', () => {
	expect(documentSchema.parse(document)).toEqual(document)
	expect(documentSchema.parse({ ...document, url: null })).toMatchObject({ readingProgress: 0 })
})

it('requires a previous reading status only for trashed Documents', () => {
	const trashed = {
		...document,
		status: 'trashed',
		previousStatus: 'later'
	} as const
	expect(documentSchema.parse(trashed)).toEqual(trashed)
	expect(documentSchema.safeParse({ ...trashed, previousStatus: undefined }).success).toBe(false)
	expect(
		documentSchema.safeParse({
			...trashed,
			trashedAt: '2026-11-12T13:00:00.000Z'
		}).success
	).toBe(false)
})

it('rejects missing or out-of-range progress instead of defaulting it', () => {
	expect(documentSchema.safeParse({ ...document, readingProgress: undefined }).success).toBe(false)
	expect(documentSchema.safeParse({ ...document, readingProgress: -0.01 }).success).toBe(false)
	expect(documentSchema.safeParse({ ...document, readingProgress: 1.01 }).success).toBe(false)
})

it('validates article metadata and its direct content relationship on the Document', () => {
	const withArticle = {
		...document,
		title: 'An article',
		siteName: 'Example',
		language: 'en',
		finalUrl: 'https://example.com/final',
		representationId: id
	}
	expect(documentSchema.parse(withArticle)).toEqual(withArticle)
	expect(documentSchema.safeParse({ ...withArticle, finalUrl: 'file:///private' }).success).toBe(
		false
	)
})
