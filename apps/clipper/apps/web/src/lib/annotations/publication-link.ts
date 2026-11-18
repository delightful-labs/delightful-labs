import { z } from 'zod'
import { isCid } from '@atcute/lexicons/syntax'

export const cidSchema = z.string().refine(isCid)
import { lowercaseUuidSchema } from '../validation/values.js'

// AT's generic DID syntax: https://atproto.com/specs/did#did-identifier-syntax
// This does not resolve the DID or prove account control.
export const didSchema = z
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
export type PublicationSource = z.infer<typeof publicationSourceSchema>

export function publicationDid(uri: string) {
	return recordUriPartsSchema.parse(atRecordUriSchema.parse(uri).split('/'))[2]
}
