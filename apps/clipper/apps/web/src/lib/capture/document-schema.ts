import { z } from 'zod'
import { positionSchema, readingProgressSchema } from '../reader/schema.js'
import { lowercaseUuidSchema, webUrlSchema } from '../validation/values.js'

export const documentReadingStatusValues = ['inbox', 'later', 'archive'] as const
export const documentStatusValues = [...documentReadingStatusValues, 'trashed'] as const
export const documentReadingStatusSchema = z.enum(documentReadingStatusValues)
const documentFields = {
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	url: webUrlSchema.nullable(),
	savedAt: z.iso.datetime(),
	readingProgress: readingProgressSchema,
	resumePosition: positionSchema.omit({ progress: true }).nullable(),
	favorite: z.boolean(),
	articleAttachmentId: lowercaseUuidSchema.nullable()
}

const activeDocumentSchema = z
	.object({ ...documentFields, status: documentReadingStatusSchema })
	.strict()
const trashedDocumentSchema = z
	.object({
		...documentFields,
		status: z.literal('trashed'),
		trashedAt: z.iso.datetime(),
		previousStatus: documentReadingStatusSchema
	})
	.strict()

export const documentSchema = z.discriminatedUnion('status', [
	activeDocumentSchema,
	trashedDocumentSchema
])
export type Document = z.infer<typeof documentSchema>

export const articleAttachmentSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	documentId: lowercaseUuidSchema,
	title: z.string().max(2048),
	author: z.string().max(2048).nullable(),
	publishedAt: z.string().max(128).nullable(),
	siteName: z.string().max(2048).nullable(),
	language: z.string().max(128).nullable(),
	finalUrl: webUrlSchema,
	canonicalUrl: webUrlSchema.nullable(),
	representationId: lowercaseUuidSchema
})
export type ArticleAttachment = z.infer<typeof articleAttachmentSchema>
