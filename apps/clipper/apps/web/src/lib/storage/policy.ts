import { z } from 'zod'
import { articleMetadataSchema } from '../capture/metadata.js'
import {
	nonblankStringSchema,
	utf8StringSchema,
	lowercaseUuidSchema,
	webUrlSchema
} from '../validation/values.js'
export const TEXT_LIMIT = 64 * 1024
export const BYTE_LIMIT = 1024 * 1024
export const titleSchema = nonblankStringSchema(500)
export const mediaTypeSchema = nonblankStringSchema(150)
export const textSchema = utf8StringSchema(TEXT_LIMIT)
export const htmlSchema = utf8StringSchema(BYTE_LIMIT)
export const extractedTextSchema = textSchema.refine((value) => !!value.trim())
export const sourceMetadataSchema = z.object({
	finalUrl: webUrlSchema.max(8192),
	submittedUrl: webUrlSchema.max(8192),
	provenance: z.string().max(32768),
	canonicalUrl: webUrlSchema.max(8192).nullable().optional()
})
export const savePayloadSchema = z
	.object({
		operationId: lowercaseUuidSchema,
		title: titleSchema,
		text: textSchema,
		bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength <= BYTE_LIMIT),
		mediaType: mediaTypeSchema.refine((value) => value === 'text/html' || value === 'text/plain')
	})
	.extend(articleMetadataSchema.shape)
export const saveRequestSchema = savePayloadSchema.extend({
	documentId: lowercaseUuidSchema.optional(),
	source: sourceMetadataSchema.optional()
})
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>
export type SaveRequest = z.infer<typeof saveRequestSchema>
// Boolean adapters let existing actor guards reuse the same schemas without throwing/logging Zod errors.
export function isValidTitle(value: unknown): value is string {
	return titleSchema.safeParse(value).success
}
export function isValidMediaType(value: unknown): value is string {
	return mediaTypeSchema.safeParse(value).success
}
export function isBoundedText(value: unknown): value is string {
	return textSchema.safeParse(value).success
}
