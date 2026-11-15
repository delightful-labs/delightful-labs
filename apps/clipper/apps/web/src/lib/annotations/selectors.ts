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
	const parsed = nativeRangeSchema.safeParse(range)
	if (!parsed.success || !normalizedText.isWellFormed()) throw projectionError()
	const { start, end, matched, before, after } = parsed.data
	if (start === undefined && end === undefined) return undefined
	if (start === undefined || end === undefined || end <= start || end > normalizedText.length) {
		throw projectionError()
	}
	const preceding = normalizedText.slice(0, start)
	const selected = normalizedText.slice(start, end)
	const following = normalizedText.slice(end)
	if (
		!preceding.isWellFormed() ||
		!selected.isWellFormed() ||
		!following.isWellFormed() ||
		!before.isWellFormed() ||
		!after.isWellFormed() ||
		selected !== matched ||
		!preceding.endsWith(before) ||
		!following.startsWith(after)
	) {
		throw projectionError()
	}
	const codePointStart = Array.from(preceding).length
	return textPositionSelectorSchema.parse({
		type: 'TextPositionSelector',
		start: codePointStart,
		end: codePointStart + Array.from(selected).length
	})
}

/** Source capture time only; never substitute note creation/publication time. */
export function toTimeState(sourceDate: Date) {
	return { type: 'TimeState', sourceDate: sourceDate.toISOString() } satisfies {
		type: 'TimeState'
		sourceDate: string
	}
}
