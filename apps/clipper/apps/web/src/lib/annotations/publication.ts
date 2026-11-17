import { z } from 'zod'
import { marginRecordSchema } from './margin.js'
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
const issuedPublicationSchema = addressed.extend({
	state: z.literal('issued'),
	record: marginRecordSchema
})

function hasMatchingPublisher(value: { publishingDid: string; uri?: string }) {
	return value.uri === undefined || value.uri.split('/')[2] === value.publishingDid
}

/** The approved first-publication lifecycle. Issued retains the exact record to
 * accept durably in Jazz before dispatch: it may have been sent and still needs
 * confirmation. This contract alone neither persists that evidence nor authorizes
 * sending/replaying a PDS request. Reserved addresses remain in the private links. */
export const publicationSchema = z
	.discriminatedUnion('state', [
		publicationBaseSchema.extend({ state: z.literal('private') }),
		publicationBaseSchema.extend({ state: z.literal('requested') }),
		issuedPublicationSchema,
		addressed.extend({ state: z.literal('published') })
	])
	.refine(hasMatchingPublisher)

export type Publication = z.infer<typeof publicationSchema>
