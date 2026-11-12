import { z } from 'zod'
import { positionSchema, readingProgressSchema } from '../reader/schema.js'
import { lowercaseUuidSchema, webUrlSchema } from '../validation/values.js'

export const documentReadingStatusValues = ['inbox', 'later', 'archive'] as const
export const documentStatusValues = [...documentReadingStatusValues, 'trashed'] as const
export const documentReadingStatusSchema = z.enum(documentReadingStatusValues)
const documentFieldsSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	url: webUrlSchema.nullable(),
	readingProgress: readingProgressSchema,
	resumePosition: positionSchema.omit({ progress: true }).nullable(),
	favorite: z.boolean(),
	title: z.string().max(2048).nullable(),
	author: z.string().max(2048).nullable(),
	publishedAt: z.string().max(128).nullable(),
	siteName: z.string().max(2048).nullable(),
	language: z.string().max(128).nullable(),
	finalUrl: webUrlSchema.nullable(),
	canonicalUrl: webUrlSchema.nullable(),
	contentRepresentationId: lowercaseUuidSchema.nullable()
})

const activeDocumentSchema = documentFieldsSchema
	.extend({ status: documentReadingStatusSchema })
	.strict()
const trashedDocumentSchema = documentFieldsSchema
	.extend({
		status: z.literal('trashed'),
		previousStatus: documentReadingStatusSchema
	})
	.strict()

export const documentSchema = z.discriminatedUnion('status', [
	activeDocumentSchema,
	trashedDocumentSchema
])
export type Document = z.infer<typeof documentSchema>
