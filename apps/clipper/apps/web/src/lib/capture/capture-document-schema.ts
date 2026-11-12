import { z } from 'zod'
import { documentSchema } from './document-schema.js'
import { lowercaseUuidSchema } from '../validation/values.js'

// Worker capture envelope. Processing state and Jazz creation metadata are not Document fields.
const captureFields = {
	libraryId: lowercaseUuidSchema,
	operationId: lowercaseUuidSchema.nullable(),
	failure: z.string().max(100).nullable(),
	createdAt: z.date()
}
export const captureDocumentSchema = z.discriminatedUnion('status', [
	documentSchema.options[0].extend(captureFields),
	documentSchema.options[1].extend(captureFields)
])
export type CaptureDocument = z.infer<typeof captureDocumentSchema>
