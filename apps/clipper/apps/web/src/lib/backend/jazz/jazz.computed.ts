import { z } from 'zod'
import type { AppTransforms } from './jazz.generated.js'
import { readingProgressSchema } from '../../reader/schema.js'

const storedProgressSchema = z.string().transform((value, context): number => {
	try {
		return readingProgressSchema.parse(JSON.parse(value))
	} catch {
		context.addIssue({ code: 'custom', message: 'Invalid stored reading progress' })
		return z.NEVER
	}
})

export const transforms = {
	readingProgress: {
		from(values) {
			const observations = z.array(storedProgressSchema).min(1).parse(values)
			return observations.reduce((maximum, value) => Math.max(maximum, value))
		},
		to(value) {
			return [JSON.stringify(readingProgressSchema.parse(value))]
		}
	}
} satisfies AppTransforms
