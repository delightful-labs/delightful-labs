import { z } from 'zod'
import { boundedText, nativeRangeSchema, offsetSchema, quoteSchema } from './schema.js'

const contextSchema = boundedText(500, 150)

/** The supported interchange subset, shared by Margin and W3C serialization.
 * These objects are projections; Jazz's native range remains the stored anchor. */
export const textQuoteSelectorSchema = z.object({
	type: z.literal('TextQuoteSelector'),
	exact: quoteSchema,
	prefix: contextSchema.optional(),
	suffix: contextSchema.optional()
})
export const textPositionSelectorSchema = z
	.object({
		type: z.literal('TextPositionSelector'),
		start: offsetSchema,
		end: offsetSchema
	})
	.refine(({ start, end }) => end > start)

const wellFormedTextSchema = z.string().refine(isWellFormedText)
const quoteOnlyRangeSchema = nativeRangeSchema.extend({
	start: z.undefined().optional(),
	end: z.undefined().optional()
})
const positionedRangeSchema = nativeRangeSchema
	.required({ start: true, end: true })
	.extend({
		before: nativeRangeSchema.shape.before.refine(isWellFormedText),
		matched: nativeRangeSchema.shape.matched.refine(isWellFormedText),
		after: nativeRangeSchema.shape.after.refine(isWellFormedText)
	})
	.refine(({ start, end }) => end > start)
const positionInputBaseSchema = z.object({
	range: nativeRangeSchema,
	normalizedText: wellFormedTextSchema
})
const positionedInputSchema = positionInputBaseSchema.extend({ range: positionedRangeSchema })
const textPositionInputSchema = z.union([
	positionInputBaseSchema.extend({ range: quoteOnlyRangeSchema }),
	positionedInputSchema
		.refine(({ range, normalizedText }) => range.end <= normalizedText.length)
		.refine(hasWholeCodePointBoundaries)
		.refine(matchesCapturedText)
])

function isWellFormedText(text: string) {
	return text.isWellFormed()
}

function hasWholeCodePointBoundaries({
	range,
	normalizedText
}: z.infer<typeof positionedInputSchema>) {
	return (
		normalizedText.slice(0, range.start).isWellFormed() &&
		normalizedText.slice(range.end).isWellFormed()
	)
}

function matchesCapturedText({ range, normalizedText }: z.infer<typeof positionedInputSchema>) {
	return (
		normalizedText.slice(range.start, range.end) === range.matched &&
		normalizedText.slice(0, range.start).endsWith(range.before) &&
		normalizedText.slice(range.end).startsWith(range.after)
	)
}

function projectionError() {
	return new Error('Annotation selector cannot be projected')
}

/** Map without trimming, truncating or normalizing the retained quotation.
 * Representation verification belongs to the caller before public export. */
export function toTextQuoteSelector(range: z.infer<typeof nativeRangeSchema>) {
	const result = textQuoteSelectorSchema.safeParse({
		type: 'TextQuoteSelector',
		exact: range.matched,
		prefix: range.before,
		suffix: range.after
	})
	if (!result.success) throw projectionError()
	return result.data
}

/** Convert only against the exact normalized representation that owns this range.
 * A reader result describes that reader, never positions on its source webpage.
 * Missing offsets leave quotation-only anchoring available; contradictory evidence
 * is refused rather than repaired by searching or approximate matching. */
export function toTextPositionSelector(
	range: z.infer<typeof nativeRangeSchema>,
	normalizedText: string
) {
	const parsed = textPositionInputSchema.safeParse({ range, normalizedText })
	if (!parsed.success) throw projectionError()
	const captured = parsed.data.range
	if (captured.start === undefined) return undefined
	const codePointStart = Array.from(normalizedText.slice(0, captured.start)).length
	return textPositionSelectorSchema.parse({
		type: 'TextPositionSelector',
		start: codePointStart,
		end: codePointStart + Array.from(captured.matched).length
	})
}

/** Source capture time only; never substitute note creation/publication time. */
export function toTimeState(sourceDate: Date) {
	return { type: 'TimeState', sourceDate: sourceDate.toISOString() } satisfies {
		type: 'TimeState'
		sourceDate: string
	}
}
