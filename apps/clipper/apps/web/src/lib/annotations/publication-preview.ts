import { z } from 'zod'
import { marginRecordSchema } from './margin.js'
import { didSchema, publicationLinkSchema, publicationSourceSchema } from './publication-link.js'

/** A temporary display snapshot, never consent, a reserved address or proof of
 * publication. The publisher must recheck accepted source data before issuance. */
export const publicationPreviewSchema = z.strictObject({
	libraryId: publicationLinkSchema.shape.libraryId,
	source: publicationSourceSchema,
	publishingDid: didSchema,
	record: marginRecordSchema
})
export type PublicationPreview = z.infer<typeof publicationPreviewSchema>
