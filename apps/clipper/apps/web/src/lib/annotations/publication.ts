import { z } from 'zod'
import {
	atRecordUriSchema,
	didSchema,
	publicationLinkSchema,
	publicationSourceSchema
} from './publication-link.js'

export const publicationBaseSchema = z.strictObject({
	libraryId: publicationLinkSchema.shape.libraryId,
	source: publicationSourceSchema,
	publishingDid: didSchema
})
const addressed = publicationBaseSchema.extend({ uri: atRecordUriSchema })

function hasMatchingPublisher(value: { publishingDid: string; uri?: string }) {
	return value.uri === undefined || value.uri.split('/')[2] === value.publishingDid
}

/** The approved first-publication lifecycle. Reserved addresses remain in the
 * existing private link store. This value is not immutable issued-write evidence
 * and must not be treated as authority to send or replay a PDS request. */
export const publicationSchema = z
	.discriminatedUnion('state', [
		publicationBaseSchema.extend({ state: z.literal('private') }),
		publicationBaseSchema.extend({ state: z.literal('requested') }),
		addressed.extend({ state: z.literal('issued') }),
		addressed.extend({ state: z.literal('published') })
	])
	.refine(hasMatchingPublisher)

export type Publication = z.infer<typeof publicationSchema>
