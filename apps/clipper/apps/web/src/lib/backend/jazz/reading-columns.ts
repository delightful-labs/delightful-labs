import { schema as s } from 'jazz-tools'
import { z } from 'zod'
import {
	readingProgressSchema,
	resumePositionSchema,
	encodeResumePosition,
	decodeResumePosition
} from '../../reader/schema.js'

const storedProgressSchema = z.string().transform((value, context): number => {
	try {
		return readingProgressSchema.parse(JSON.parse(value))
	} catch {
		context.addIssue({ code: 'custom', message: 'Invalid stored reading progress' })
		return z.NEVER
	}
})
/** Jazz unions observations across offline replicas; callers read/write a bounded number.
 * Decimal strings avoid alpha.60's non-finite-cell failure when uploading FLOAT sets.
 * JSON preserves the public number exactly; this encoding does not quantize progress. */
export const readingProgressColumn = s
	.array(s.string())
	.merge('g-set')
	.transform({
		from(values): number {
			const observations = z.array(storedProgressSchema).min(1).parse(values)
			return observations.reduce((maximum, value) => Math.max(maximum, value))
		},
		to(value: number) {
			return [JSON.stringify(readingProgressSchema.parse(value))]
		}
	})
/** Last location is independent of furthest progress and may move backward. */
export const resumePositionColumn = s
	.array(s.string())
	.merge('g-set')
	.transform({
		from(values): z.infer<typeof resumePositionSchema> | null {
			const candidates = values.map((value) => ({
				key: value,
				position: decodeResumePosition(JSON.parse(value))
			}))
			candidates.sort(
				(a, b) =>
					a.position.interactedAt.getTime() - b.position.interactedAt.getTime() ||
					(a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
			)
			return candidates.at(-1)?.position ?? null
		},
		to(value: z.infer<typeof resumePositionSchema> | null) {
			return value === null
				? []
				: [JSON.stringify(encodeResumePosition(resumePositionSchema.parse(value)))]
		}
	})
