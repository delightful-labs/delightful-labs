import { z } from 'zod'
import { lowercaseUuidSchema } from '../validation/values.js'

// AT's generic DID syntax: https://atproto.com/specs/did#did-identifier-syntax
// This does not resolve the DID or prove account control.
const didSchema = z
	.string()
	.max(2048)
	.regex(/^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/)
const recordKeySchema = z
	.string()
	.min(1)
	.max(512)
	.regex(/^[a-zA-Z0-9._~:-]+$/)
	.refine((value) => value !== '.' && value !== '..')
const recordUriPartsSchema = z.tuple([
	z.literal('at:'),
	z.literal(''),
	didSchema,
	z.literal('at.margin.note'),
	recordKeySchema
])
/** Restricted full-record AT URI syntax. The publication owner separately verifies
 * the publishing DID, authorization and record contents before any PDS operation. */
export const atRecordUriSchema = z
	.string()
	.max(8192)
	.refine((value) => recordUriPartsSchema.safeParse(value.split('/')).success)
export const publicationSourceSchema = z.union([
	z.strictObject({ highlightId: lowercaseUuidSchema }),
	z.strictObject({ noteId: lowercaseUuidSchema })
])
export const publicationLinkSchema = z.object({
	libraryId: lowercaseUuidSchema,
	source: publicationSourceSchema,
	uri: atRecordUriSchema
})
export type PublicationLink = z.infer<typeof publicationLinkSchema>
export type PublicationSource = z.infer<typeof publicationSourceSchema>

export function publicationLinkValues(link: PublicationLink) {
	const parsed = publicationLinkSchema.parse(link)
	return {
		libraryId: parsed.libraryId,
		highlightId: 'highlightId' in parsed.source ? parsed.source.highlightId : null,
		noteId: 'noteId' in parsed.source ? parsed.source.noteId : null,
		uri: parsed.uri
	}
}

const rowBaseSchema = publicationLinkSchema.omit({ source: true })
const linkRowSchema = z.union([
	rowBaseSchema.extend({ highlightId: lowercaseUuidSchema, noteId: z.null() }),
	rowBaseSchema.extend({ highlightId: z.null(), noteId: lowercaseUuidSchema })
])
/** Native FK columns describe the approved source union through Jazz joins. */
export function publicationLinkFromRow(row: unknown): PublicationLink {
	const parsed = linkRowSchema.parse(row)
	return publicationLinkSchema.parse({
		libraryId: parsed.libraryId,
		source:
			parsed.highlightId === null ? { noteId: parsed.noteId } : { highlightId: parsed.highlightId },
		uri: parsed.uri
	})
}

export function publicationDid(uri: string) {
	return recordUriPartsSchema.parse(atRecordUriSchema.parse(uri).split('/'))[2]
}
