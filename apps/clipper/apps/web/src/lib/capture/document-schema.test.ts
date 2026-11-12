import { expect, it } from 'vitest'
import { articleAttachmentSchema, documentSchema } from './document-schema.js'

const id = 'abcdef01-2345-6789-abcd-ef0123456789'
const document = {
	id,
	libraryId: id,
	url: 'https://example.com/article',
	savedAt: '2026-11-12T12:00:00.000Z',
	readingProgress: 0,
	resumePosition: null,
	favorite: false,
	articleAttachmentId: null,
	status: 'inbox'
} as const

it('accepts a saved Document with required numeric progress and no attachment', () => {
	expect(documentSchema.parse(document)).toEqual(document)
	expect(documentSchema.parse({ ...document, url: null })).toMatchObject({ readingProgress: 0 })
})

it('requires a previous reading status and timestamp only for trashed Documents', () => {
	const trashed = {
		...document,
		status: 'trashed',
		trashedAt: '2026-11-12T13:00:00.000Z',
		previousStatus: 'later'
	} as const
	expect(documentSchema.parse(trashed)).toEqual(trashed)
	expect(documentSchema.safeParse({ ...trashed, trashedAt: undefined }).success).toBe(false)
	expect(documentSchema.safeParse({ ...trashed, previousStatus: undefined }).success).toBe(false)
	expect(
		documentSchema.safeParse({ ...document, trashedAt: '2026-11-12T13:00:00.000Z' }).success
	).toBe(false)
})

it('rejects missing or out-of-range progress instead of defaulting it', () => {
	expect(documentSchema.safeParse({ ...document, readingProgress: undefined }).success).toBe(false)
	expect(documentSchema.safeParse({ ...document, readingProgress: -0.01 }).success).toBe(false)
	expect(documentSchema.safeParse({ ...document, readingProgress: 1.01 }).success).toBe(false)
})

it('validates the independent Article attachment and representation relationship fields', () => {
	const attachment = {
		id,
		libraryId: id,
		documentId: id,
		title: 'An article',
		author: null,
		publishedAt: null,
		siteName: 'Example',
		language: 'en',
		finalUrl: 'https://example.com/final',
		canonicalUrl: null,
		representationId: id
	}
	expect(articleAttachmentSchema.parse(attachment)).toEqual(attachment)
	expect(
		articleAttachmentSchema.safeParse({ ...attachment, finalUrl: 'file:///private' }).success
	).toBe(false)
})
