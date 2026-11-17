import { isDeepStrictEqual } from 'node:util'
import { marginRecordSchema } from '../../annotations/margin.js'
import { publicationSchema } from '../../annotations/publication.js'
import { parsePdsRecord } from './pds-record.js'
import type { PdsRecord } from './pds-record.js'

type JsonValue = PdsRecord['value'][string]
const ownedFields = new Set(
	marginRecordSchema.options.flatMap((option) => Object.keys(option.shape))
)

function targetContent(value: JsonValue): JsonValue {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
	// Margin defines these as page title and an indexing hash. Other additions,
	// including resource state and selector refinements, may alter the target.
	return Object.fromEntries(
		Object.entries(value).filter(([key]) => key !== 'title' && key !== 'sourceHash')
	)
}

/** A pure guard for a found record at the retained issued address. Compare the
 * frozen owned fields without modifying the complete remote observation. Body,
 * selector and timestamp differences are not normalized or silently discarded.
 * This checks owned content, not foreign metadata validity or a content digest;
 * it neither confirms a write nor authorizes overwriting/retrying/recreating one. */
export function matchesIssuedContent(issued: unknown, observed: unknown): boolean {
	const publication = publicationSchema.safeParse(issued)
	if (!publication.success || publication.data.state !== 'issued')
		throw new Error('Publication content cannot be compared')
	const remote = parsePdsRecord(observed, publication.data.uri)
	const content = Object.fromEntries(
		Object.entries(remote.value)
			.filter(([key]) => ownedFields.has(key))
			.map(
				([key, value]) =>
					[key, key === 'target' ? targetContent(value) : value] satisfies [string, JsonValue]
			)
	)
	return isDeepStrictEqual(content, publication.data.record)
}
