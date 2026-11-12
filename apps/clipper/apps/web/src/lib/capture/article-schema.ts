import { z } from 'zod'
import { lowercaseUuidSchema, webUrlSchema } from '../validation/values.js'
import { articleMetadataSchema } from './metadata.js'
import { htmlSchema, textSchema, titleSchema } from '../storage/policy.js'

export const assetSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	operationId: lowercaseUuidSchema,
	mediaType: z.string(),
	payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array)
})
export const captureSourceSchema = z.object({
	resolvedUrl: webUrlSchema.max(8192),
	canonicalUrl: webUrlSchema.max(8192).nullable()
})
export const siteSchema = z.object({
	id: lowercaseUuidSchema,
	origin: webUrlSchema.refine((value) => new URL(value).origin === value),
	name: articleMetadataSchema.shape.siteName.nonoptional(),
	favicon: assetSchema.nullable()
})
export const articleSchema = z.object({
	id: lowercaseUuidSchema,
	title: titleSchema,
	excerpt: articleMetadataSchema.shape.excerpt.nonoptional(),
	author: articleMetadataSchema.shape.author.nonoptional(),
	publishedAt: articleMetadataSchema.shape.publishedTime.nonoptional(),
	language: articleMetadataSchema.shape.lang.nonoptional(),
	site: siteSchema.nullable(),
	source: captureSourceSchema.nullable(),
	html: htmlSchema,
	text: textSchema
})
export type Article = z.infer<typeof articleSchema>
export type Site = z.infer<typeof siteSchema>
export type CaptureSource = z.infer<typeof captureSourceSchema>
