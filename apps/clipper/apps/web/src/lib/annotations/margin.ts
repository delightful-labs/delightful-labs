import { z } from 'zod'
import { webUrlSchema } from '../validation/values.js'
import {
	annotationNoteRowSchema,
	highlightRowSchema,
	noteInputTextSchema,
	textFingerprint
} from './schema.js'
import type { AnnotationHighlight, AnnotationNote } from './schema.js'
import {
	textQuoteSelectorSchema,
	toTextPositionSelector,
	toTextQuoteSelector
} from './selectors.js'

const targetSchema = z.strictObject({ source: webUrlSchema })
const selectorSchema = textQuoteSelectorSchema.strict()
const recordBaseSchema = z.strictObject({
	$type: z.literal('at.margin.note'),
	createdAt: z.iso.datetime(),
	modifiedAt: z.iso.datetime().optional()
})
const highlightRecordSchema = recordBaseSchema.extend({
	motivation: z.literal('highlighting'),
	target: targetSchema.extend({ selector: selectorSchema })
})
const commentRecordSchema = recordBaseSchema.extend({
	motivation: z.literal('commenting'),
	target: targetSchema.extend({ selector: selectorSchema.optional() }),
	body: z.strictObject({ value: noteInputTextSchema, format: z.literal('text/plain') })
})

/** Clipper's approved owned-content subset, not a reader/serializer for arbitrary
 * remote Margin records. Never use this narrow shape to replace an observed record:
 * future updates must preserve its foreign metadata and reconcile its content. */
export const marginRecordSchema = z.discriminatedUnion('motivation', [
	highlightRecordSchema,
	commentRecordSchema
])
export type MarginRecord = z.infer<typeof marginRecordSchema>

function projectionError() {
	return new Error('Annotation cannot be projected to Margin')
}

function parseProjection<Schema extends z.ZodType>(schema: Schema, input: unknown) {
	const result = schema.safeParse(input)
	if (!result.success) throw projectionError()
	return result.data
}

function publicationTimes(createdAt: Date, modifiedAt?: Date) {
	const created = parseProjection(z.date(), createdAt).toISOString()
	return {
		createdAt: created,
		...(modifiedAt === undefined
			? {}
			: { modifiedAt: parseProjection(z.date(), modifiedAt).toISOString() })
	}
}

/** A pure snapshot projection. The publication owner supplies the retained first
 * publication time and, on update, its fixed modification time; this never reads
 * the clock or allocates a public identity. Eligibility/acceptance belongs to that
 * owner before issuance. Clearing text preserves the Note and its empty body. */
export function toMarginDocumentNote(note: AnnotationNote, createdAt: Date, modifiedAt?: Date) {
	const snapshot = parseProjection(annotationNoteRowSchema, note)
	if (!snapshot.documentId || !snapshot.source || snapshot.highlightId !== null) {
		throw projectionError()
	}
	return parseProjection(commentRecordSchema, {
		$type: 'at.margin.note',
		motivation: 'commenting',
		target: { source: snapshot.source },
		body: { value: snapshot.text, format: 'text/plain' },
		...publicationTimes(createdAt, modifiedAt)
	})
}

/** Project a selected source-page anchor against its exact normalized capture text.
 * No source normalization algorithm is selected here. The capture owner supplies
 * text normalized according to the retained version; hash and native range must
 * agree. Reader-only, unresolved and contradictory evidence cannot be published.
 * Requires retained source offsets for verification; positions stay out of Margin.
 * All inputs are copied/validated before awaiting the deterministic text digest.
 * This has no network, persistence, permissions or public-write effects. */
export async function toMarginHighlight(
	highlight: AnnotationHighlight,
	sourceAnchorId: string,
	normalizedSourceText: string,
	createdAt: Date,
	modifiedAt?: Date
): Promise<MarginRecord> {
	const snapshot = parseProjection(highlightRowSchema, highlight)
	const times = publicationTimes(createdAt, modifiedAt)
	const candidates = snapshot.anchors.filter((anchor) => anchor.id === sourceAnchorId)
	const anchor = candidates[0]
	if (
		candidates.length !== 1 ||
		!anchor ||
		anchor.highlightId !== snapshot.id ||
		anchor.kind !== 'source' ||
		!anchor.normalizationVersion.trim() ||
		snapshot.notes.length > 1
	) {
		throw projectionError()
	}
	const note = snapshot.notes[0]
	if (
		note &&
		(note.libraryId !== snapshot.libraryId ||
			note.highlightId !== snapshot.id ||
			note.documentId !== null ||
			note.source !== null)
	) {
		throw projectionError()
	}
	const position = toTextPositionSelector(anchor.range, normalizedSourceText)
	if (!position) throw projectionError()
	const selector = toTextQuoteSelector(anchor.range)
	const record = parseProjection(marginRecordSchema, {
		$type: 'at.margin.note',
		motivation: note ? 'commenting' : 'highlighting',
		target: { source: snapshot.source, selector },
		...(note ? { body: { value: note.text, format: 'text/plain' } } : {}),
		...times
	})
	if ((await textFingerprint(normalizedSourceText)) !== anchor.textHash) throw projectionError()
	return record
}
