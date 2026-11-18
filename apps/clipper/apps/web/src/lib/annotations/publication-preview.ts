import { z } from 'zod'
import { marginRecordSchema } from './margin.js'
import { publicationBaseSchema } from './publication.js'

/** A temporary display snapshot, never consent, a reserved address or proof of
 * publication. The publisher must recheck accepted source data before issuance. */
export const publicationPreviewSchema = publicationBaseSchema.extend({
	record: marginRecordSchema
})
export type PublicationPreview = z.infer<typeof publicationPreviewSchema>
