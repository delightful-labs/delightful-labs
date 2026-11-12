import { z } from 'zod'
import { lowercaseUuidSchema } from '../validation/values.js'
import { causalHeads, causalParentsSchema } from '../capture/causal.js'

export const preferenceSchemas = {
	theme: z.enum(['system', 'light', 'dark']),
	font: z.enum(['serif', 'sans']),
	size: z.number().int().min(16).max(32),
	spacing: z.number().min(1.3).max(2),
	width: z.number().int().min(40).max(100)
}
export const preferencesSchema = z.object(preferenceSchemas)
export type ReaderPreferences = z.infer<typeof preferencesSchema>
export const defaultPreferences: ReaderPreferences = {
	theme: 'system',
	font: 'serif',
	size: 20,
	spacing: 1.6,
	width: 65
}
export const readingProgressSchema = z.number().min(0).max(1)
export function advanceReadingProgress(current: number, observed: number) {
	return Math.max(readingProgressSchema.parse(current), readingProgressSchema.parse(observed))
}
export const resumePositionSchema = z.object({
	version: z.literal(1),
	offset: z.number().int().min(0).max(10_000_000),
	quote: z.string().min(1).max(160),
	prefix: z.string().max(48),
	suffix: z.string().max(48),
	interactedAt: z.date()
})
export type ResumePosition = z.infer<typeof resumePositionSchema>
export const readingMeasurementSchema = resumePositionSchema
	.extend({
		extent: z.number().int().min(1).max(10_000_000),
		atEnd: z.boolean()
	})
	.refine((value) => value.offset < value.extent)
export type ReadingMeasurement = z.infer<typeof readingMeasurementSchema>
/** The worker applies this same calculation to scrolling and final detach measurements. */
export function positionFromMeasurement(value: ReadingMeasurement): ReadingPosition {
	const { extent, atEnd, ...position } = readingMeasurementSchema.parse(value)
	return positionSchema.parse({ ...position, progress: atEnd ? 1 : position.offset / extent })
}
export const positionSchema = resumePositionSchema.extend({ progress: readingProgressSchema })
export type ReadingPosition = z.infer<typeof positionSchema>
export const encodedResumePositionSchema = resumePositionSchema.extend({
	interactedAt: z.iso.datetime()
})
export function encodeResumePosition(position: z.infer<typeof resumePositionSchema>) {
	return { ...position, interactedAt: position.interactedAt.toISOString() }
}
export function decodeResumePosition(value: unknown) {
	const position = encodedResumePositionSchema.parse(value)
	return resumePositionSchema.parse({ ...position, interactedAt: new Date(position.interactedAt) })
}
export function encodeReaderValue(change: ReaderChange) {
	return JSON.stringify(
		change.field === 'position'
			? { ...encodeResumePosition(change.value), progress: change.value.progress }
			: change.value
	)
}
const preferenceChangeSchema = z.object({ documentId: z.null() })
export const readerPreferenceChangeSchema = z.discriminatedUnion('field', [
	preferenceChangeSchema.extend({ field: z.literal('theme'), value: preferenceSchemas.theme }),
	preferenceChangeSchema.extend({ field: z.literal('font'), value: preferenceSchemas.font }),
	preferenceChangeSchema.extend({ field: z.literal('size'), value: preferenceSchemas.size }),
	preferenceChangeSchema.extend({ field: z.literal('spacing'), value: preferenceSchemas.spacing }),
	preferenceChangeSchema.extend({ field: z.literal('width'), value: preferenceSchemas.width })
])
export type ReaderPreferenceChange = z.infer<typeof readerPreferenceChangeSchema>
export const readerChangeSchema = z.discriminatedUnion('field', [
	...readerPreferenceChangeSchema.options,
	z.object({ documentId: lowercaseUuidSchema, field: z.literal('position'), value: positionSchema })
])
export type ReaderChange = z.infer<typeof readerChangeSchema>
export function isValidReaderChange(value: unknown): value is ReaderChange {
	return readerChangeSchema.safeParse(value).success
}
const encodedValue = z
	.string()
	.max(4096)
	.transform((value, context): unknown => {
		try {
			return JSON.parse(value)
		} catch {
			context.addIssue({ code: 'custom', message: 'Invalid reading value' })
			return z.NEVER
		}
	})
export const readerOperationSchema = z
	.object({
		id: lowercaseUuidSchema,
		libraryId: lowercaseUuidSchema,
		field: z.string(),
		value: encodedValue,
		parents: causalParentsSchema
	})
	.transform((row, context) => {
		const change = readerPreferenceChangeSchema.safeParse({ ...row, documentId: null })
		if (!change.success) {
			context.addIssue({ code: 'custom', message: 'Invalid reading operation' })
			return z.NEVER
		}
		return { id: row.id, libraryId: row.libraryId, parents: row.parents, ...change.data }
	})
export type ReaderOperation = z.infer<typeof readerOperationSchema>
export const readerHistorySchema = z.array(readerOperationSchema)
export function canQueueReaderChange(
	queue: readonly ReaderChange[],
	change: unknown
): change is ReaderChange {
	return (
		isValidReaderChange(change) &&
		(queue.length < 64 || queue.some((item) => readerChangeKey(item) === readerChangeKey(change)))
	)
}
export function readerChangeKey(change: Pick<ReaderChange, 'documentId' | 'field'>) {
	return `${change.documentId ?? 'library'}:${change.field}`
}
export function sameReaderField(a: ReaderChange, b: ReaderChange) {
	return a.documentId === b.documentId && a.field === b.field
}
export function mergeReadingProgress(
	current: Record<string, number>,
	observed: Record<string, number>
) {
	const progress = { ...current }
	for (const [id, value] of Object.entries(observed)) {
		progress[id] =
			progress[id] === undefined
				? readingProgressSchema.parse(value)
				: advanceReadingProgress(progress[id], value)
	}
	return progress
}
export function reconcilePositionProgress(
	current: Record<string, number>,
	documentId: string,
	position: ReadingPosition
) {
	const progress = {
		...current,
		[documentId]: advanceReadingProgress(
			readingProgressSchema.parse(current[documentId]),
			position.progress
		)
	}
	return {
		progress,
		position: {
			...position,
			progress: readingProgressSchema.parse(progress[documentId])
		}
	}
}
export const readerDocumentStateSchema = z.object({
	id: lowercaseUuidSchema,
	readingProgress: readingProgressSchema,
	resumePosition: resumePositionSchema.nullable()
})
export type ReaderDocumentState = z.infer<typeof readerDocumentStateSchema>
export function projectReaderState(
	operations: readonly ReaderOperation[],
	documents: readonly ReaderDocumentState[] = []
) {
	const preferences = { ...defaultPreferences }
	for (const field of [
		'theme',
		'font',
		'size',
		'spacing',
		'width'
	] satisfies (keyof ReaderPreferences)[]) {
		const value = causalHeads(
			operations.filter((row) => row.documentId === null && row.field === field)
		).at(-1)?.value
		if (value !== undefined) Object.assign(preferences, { [field]: value })
	}
	const positions: Record<string, ReadingPosition> = {},
		progress: Record<string, number> = {}
	for (const document of documents) {
		progress[document.id] = readingProgressSchema.parse(document.readingProgress)
		if (document.resumePosition)
			positions[document.id] = { ...document.resumePosition, progress: document.readingProgress }
	}
	return { preferences, positions, progress }
}

export function documentReadingProgress(
	document: { id: string; readingProgress: number },
	live: Record<string, number>
) {
	const observed = live[document.id]
	return observed === undefined
		? readingProgressSchema.parse(document.readingProgress)
		: advanceReadingProgress(document.readingProgress, observed)
}
