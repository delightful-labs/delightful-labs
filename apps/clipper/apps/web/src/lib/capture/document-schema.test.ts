import { expect, it } from 'vitest'
import { documentSchema, newDocument } from './document-schema.js'
import { fixtureAttachment } from './fixtures.test-support.js'
const id = 'abcdef01-2345-6789-abcd-ef0123456789'
const document = newDocument(id, id, 'https://example.com/article?q=1#passage')
it('creates required zero progress and actual relationships without article metadata', () => {
	expect(document).toMatchObject({
		readingProgress: 0,
		resumePosition: null,
		attachment: null,
		library: { id }
	})
	expect(documentSchema.parse({ ...document, attachment: fixtureAttachment() })).toMatchObject({
		attachment: { title: 'Saved title' }
	})
	for (const field of [
		'title',
		'author',
		'publishedAt',
		'siteName',
		'language',
		'contentRepresentationId',
		'attachmentId',
		'savedAt',
		'trashedAt'
	])
		expect(documentSchema.safeParse({ ...document, [field]: 'unexpected' }).success).toBe(false)
})
it('requires previousStatus exactly in the trashed variant', () => {
	expect(
		documentSchema.safeParse({ ...document, status: 'trashed', previousStatus: 'later' }).success
	).toBe(true)
	expect(documentSchema.safeParse({ ...document, status: 'trashed' }).success).toBe(false)
	expect(documentSchema.safeParse({ ...document, previousStatus: 'later' }).success).toBe(false)
})
it.each([undefined, null, NaN, Infinity, -Infinity, -0.01, 1.01])(
	'rejects invalid progress %s without a fallback',
	(readingProgress) => {
		expect(documentSchema.safeParse({ ...document, readingProgress }).success).toBe(false)
	}
)
it('requires a Date for the resume interaction time', () => {
	const resumePosition = {
		version: 1,
		offset: 0,
		quote: 'Read',
		prefix: '',
		suffix: '',
		interactedAt: new Date()
	}
	expect(documentSchema.safeParse({ ...document, resumePosition }).success).toBe(true)
	expect(
		documentSchema.safeParse({
			...document,
			resumePosition: { ...resumePosition, interactedAt: resumePosition.interactedAt.toISOString() }
		}).success
	).toBe(false)
})
