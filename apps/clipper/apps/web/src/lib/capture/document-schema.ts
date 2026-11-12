import { z } from 'zod'
import { resumePositionSchema, readingProgressSchema } from '../reader/schema.js'
import { lowercaseUuidSchema, webUrlSchema } from '../validation/values.js'
import { articleSchema } from './article-schema.js'

export const documentReadingStatusSchema = z.enum(['inbox', 'later', 'archive'])
export const documentStatusSchema = z.enum([...documentReadingStatusSchema.options, 'trashed'])
export const librarySchema = z.object({
	id: lowercaseUuidSchema,
	ownerId: lowercaseUuidSchema,
	bootstrapVersion: z.literal('1')
})
export const documentFieldsSchema = z.object({
	id: lowercaseUuidSchema,
	library: librarySchema,
	sourceUrl: webUrlSchema.nullable(),
	readingProgress: readingProgressSchema,
	resumePosition: resumePositionSchema.nullable(),
	favorite: z.boolean(),
	attachment: articleSchema.nullable()
})
const activeDocumentSchema = documentFieldsSchema
	.extend({ status: documentReadingStatusSchema })
	.strict()
const trashedDocumentSchema = documentFieldsSchema
	.extend({ status: z.literal('trashed'), previousStatus: documentReadingStatusSchema })
	.strict()
export const documentSchema = z.discriminatedUnion('status', [
	activeDocumentSchema,
	trashedDocumentSchema
])
export type Document = z.infer<typeof documentSchema>

/** All creation paths supply the same required initial user state. */
export function newDocument(id: string, libraryId: string, sourceUrl: string | null): Document {
	return documentSchema.parse({
		id,
		library: { id: libraryId, ownerId: libraryId, bootstrapVersion: '1' },
		sourceUrl,
		readingProgress: 0,
		resumePosition: null,
		favorite: false,
		attachment: null,
		status: 'inbox'
	})
}
