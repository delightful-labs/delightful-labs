import { z } from 'zod'
import { marginRecordSchema } from './margin.js'
import { lowercaseUuidSchema } from '../validation/values.js'
import { atRecordUriSchema, didSchema, publicationSourceSchema } from './publication-link.js'

export const publicationBaseSchema = z.strictObject({
	libraryId: lowercaseUuidSchema,
	source: publicationSourceSchema,
	publishingDid: didSchema
})
const privateLifecycle = z.strictObject({ state: z.literal('private') })
const requestedLifecycle = z.strictObject({ state: z.literal('requested') })
const issuedLifecycle = z.strictObject({
	state: z.literal('issued'),
	uri: atRecordUriSchema,
	record: marginRecordSchema
})
const publishedLifecycle = z.strictObject({ state: z.literal('published'), uri: atRecordUriSchema })

export const publicationLifecycleSchema = z.discriminatedUnion('state', [
	privateLifecycle,
	requestedLifecycle,
	issuedLifecycle,
	publishedLifecycle
])

function hasMatchingPublisher(value: { publishingDid: string; uri?: string }) {
	return value.uri === undefined || value.uri.split('/')[2] === value.publishingDid
}

/** The approved first-publication lifecycle. Issued retains the exact record to
 * accept durably in Jazz before dispatch: it may have been sent and still needs
 * confirmation. This contract alone neither persists that evidence nor authorizes
 * sending/replaying a PDS request. */
export const publicationSchema = z
	.discriminatedUnion('state', [
		publicationBaseSchema.extend(privateLifecycle.shape),
		publicationBaseSchema.extend(requestedLifecycle.shape),
		publicationBaseSchema.extend(issuedLifecycle.shape),
		publicationBaseSchema.extend(publishedLifecycle.shape)
	])
	.refine(hasMatchingPublisher)

export type Publication = z.infer<typeof publicationSchema>

/** Native columns hold the binding once; one JSON value holds its lifecycle. */
export function publicationValues(publication: Publication) {
	const { libraryId, source, publishingDid, ...lifecycle } = publicationSchema.parse(publication)
	return {
		libraryId,
		highlightId: 'highlightId' in source ? source.highlightId : null,
		noteId: 'noteId' in source ? source.noteId : null,
		publishingDid,
		lifecycle
	}
}

const rowBaseSchema = publicationBaseSchema
	.omit({ source: true })
	.extend({ lifecycle: publicationLifecycleSchema })
	.strip()
const publicationRowSchema = z.union([
	rowBaseSchema.extend({ highlightId: lowercaseUuidSchema, noteId: z.null() }),
	rowBaseSchema.extend({ highlightId: z.null(), noteId: lowercaseUuidSchema })
])

export function publicationFromRow(row: unknown): Publication {
	const value = publicationRowSchema.parse(row)
	return publicationSchema.parse({
		libraryId: value.libraryId,
		source:
			value.highlightId === null ? { noteId: value.noteId } : { highlightId: value.highlightId },
		publishingDid: value.publishingDid,
		...value.lifecycle
	})
}
