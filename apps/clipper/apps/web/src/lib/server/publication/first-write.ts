import { z } from 'zod'
import { marginRecordSchema } from '../../annotations/margin.js'
import { publicationBaseSchema, publicationSchema } from '../../annotations/publication.js'

// Margin requires TID keys for newly created notes. Retained publication URIs
// keep their broader record-key reader so imported/older addresses still parse.
const tidSchema = z
	.string()
	.length(13)
	.regex(/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/)

/** The approved body for com.atproto.repo.putRecord's first write. Explicit null
 * is required: omission would remove the record-absence condition. */
export const firstPublicationWriteSchema = z.strictObject({
	repo: publicationBaseSchema.shape.publishingDid,
	collection: z.literal('at.margin.note'),
	rkey: tidSchema,
	record: marginRecordSchema,
	swapRecord: z.null()
})
export type FirstPublicationWrite = z.infer<typeof firstPublicationWriteSchema>

/** Pure request preparation from the retained issued value, never from the live
 * Note or preview. The caller must establish native acceptance, current access,
 * grant and remote reconciliation before dispatch. This does not send or retry
 * anything, and a successfully parsed value is not proof of Jazz acceptance. */
export function toFirstPublicationWrite(input: unknown): FirstPublicationWrite {
	const publication = publicationSchema.safeParse(input)
	if (!publication.success || publication.data.state !== 'issued')
		throw new Error('Publication cannot prepare a first write')
	const { publishingDid, uri, record } = publication.data
	const write = firstPublicationWriteSchema.safeParse({
		repo: publishingDid,
		collection: 'at.margin.note',
		rkey: uri.split('/')[4],
		record,
		swapRecord: null
	})
	if (!write.success) throw new Error('Publication cannot prepare a first write')
	return write.data
}
