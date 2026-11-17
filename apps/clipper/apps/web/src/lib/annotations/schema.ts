import { z } from 'zod'
import { lowercaseUuidSchema } from '../validation/values.js'

const encoder = new TextEncoder()
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' })
export function boundedText(bytes: number, clusters: number) {
	return z
		.string()
		.refine(
			(text) =>
				text.isWellFormed() &&
				encoder.encode(text).length <= bytes &&
				Array.from(graphemes.segment(text)).length <= clusters
		)
}
export const noteInputTextSchema = boundedText(10_000, 3_000)
export const quoteSchema = boundedText(5_000, 1_500).min(1)
export const offsetSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const nativeRangeSchema = z.object({
	version: offsetSchema.optional(),
	start: offsetSchema.optional(),
	end: offsetSchema.optional(),
	before: z.string(),
	matched: z.string(),
	after: z.string()
})
const parentFields = { documentId: lowercaseUuidSchema }
export const annotationCommandSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('OPEN'), ...parentFields, text: z.string().max(8_000_000) }),
	z.object({ type: z.literal('CLOSE') }),
	z.object({ type: z.literal('PREVIEW_NOTE'), ...parentFields, id: lowercaseUuidSchema }),
	z.object({ type: z.literal('CLOSE_PREVIEW'), ...parentFields, requestId: offsetSchema }),
	z.object({
		type: z.literal('KEEP_DRAFT'),
		...parentFields,
		id: lowercaseUuidSchema,
		writerId: lowercaseUuidSchema
	}),
	z.object({
		type: z.literal('HIGHLIGHT'),
		...parentFields,
		text: z.string().max(8_000_000),
		start: offsetSchema,
		end: offsetSchema
	}),
	z.object({
		type: z.literal('ADD_NOTE'),
		...parentFields,
		highlightId: lowercaseUuidSchema.optional()
	}),
	z.object({
		type: z.literal('EDIT_NOTE'),
		...parentFields,
		id: lowercaseUuidSchema,
		text: z.string(),
		editedFrom: z.string()
	}),
	z.object({
		type: z.enum(['DELETE_HIGHLIGHT', 'RESTORE_HIGHLIGHT', 'DELETE_NOTE']),
		...parentFields,
		id: lowercaseUuidSchema
	})
])
export type AnnotationCommand = z.infer<typeof annotationCommandSchema>
export type AnnotationMutation = Exclude<
	AnnotationCommand,
	{ type: 'OPEN' | 'CLOSE' | 'KEEP_DRAFT' | 'PREVIEW_NOTE' | 'CLOSE_PREVIEW' }
>
export type PreparedAnnotation = {
	command: AnnotationMutation
	id: string
	anchorId: string
	range?: z.infer<typeof nativeRangeSchema>
	textHash?: string
}
export const annotationNoteRowSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	documentId: lowercaseUuidSchema.nullable(),
	highlightId: lowercaseUuidSchema.nullable(),
	source: z.string().nullable(),
	text: z.string()
})
export const anchorRowSchema = z.object({
	id: lowercaseUuidSchema,
	highlightId: lowercaseUuidSchema,
	kind: z.enum(['source', 'reader']),
	normalizationVersion: z.string(),
	textHash: z.string(),
	range: nativeRangeSchema
})
export const highlightRowSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	documentId: lowercaseUuidSchema,
	source: z.string(),
	anchors: z.array(anchorRowSchema),
	notes: z.array(annotationNoteRowSchema)
})
export type AnnotationNote = z.infer<typeof annotationNoteRowSchema>
export type AnnotationHighlight = z.infer<typeof highlightRowSchema>
export type AnnotationRows = { highlights: AnnotationHighlight[]; notes: AnnotationNote[] }
export const emptyAnnotationRows: AnnotationRows = { highlights: [], notes: [] }
/** The browser supplies native textContent/DOM offsets; normalization and range
 * capture belong to the worker, under this explicitly versioned contract. */
export const READER_TEXT_VERSION = 'clipper-dom-text-v1'
export function normalizeReaderText(text: string) {
	return text.replace(/\r\n?/g, '\n')
}
export function normalizedOffset(text: string, offset: number) {
	return normalizeReaderText(text.slice(0, offset)).length
}
/** Convert a resolved normalized range back to the original DOM's UTF-16 offsets. */
export function domOffset(text: string, offset: number) {
	let raw = 0
	for (let normalized = 0; normalized < offset && raw < text.length; normalized++) {
		raw += text[raw] === '\r' && text[raw + 1] === '\n' ? 2 : 1
	}
	return raw
}
export async function textFingerprint(text: string) {
	const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(text))
	return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('')
}
