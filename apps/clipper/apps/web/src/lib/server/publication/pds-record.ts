import { z } from 'zod'
import { isCid } from '@atcute/lexicons/syntax'
import { isDeepStrictEqual } from 'node:util'
import { atRecordUriSchema } from '../../annotations/publication-link.js'

/** The approved getRecord response subset. Keep the complete JSON record rather
 * than applying Clipper's narrow owned-content serializer to remote metadata.
 * CID syntax is checked when supplied; this does not verify a content hash. */
export const pdsRecordSchema = z.object({
	uri: atRecordUriSchema,
	cid: z.string().refine(isCid).optional(),
	value: z.record(z.string(), z.json())
})
export type PdsRecord = z.infer<typeof pdsRecordSchema>

/** A successful response must identify the exact address the owner inspected.
 * This pure reader does not classify HTTP errors/absence, compare owned content,
 * prove PDS freshness or authorize sending/retrying a write. */
export function parsePdsRecord(input: unknown, expectedUri: string): PdsRecord {
	const expected = atRecordUriSchema.safeParse(expectedUri)
	const record = pdsRecordSchema.safeParse(input)
	if (
		!expected.success ||
		!record.success ||
		record.data.uri !== expected.data ||
		typeof input !== 'object' ||
		input === null ||
		!('value' in input) ||
		// Zod intentionally drops __proto__ keys. Refuse any lossy parse rather
		// than expose a reduced record that reconciliation could later overwrite.
		!isDeepStrictEqual(input.value, record.data.value)
	)
		throw new Error('PDS record cannot be read')
	return record.data
}
