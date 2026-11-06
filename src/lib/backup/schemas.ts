import { z } from 'zod'
import type { PayloadLimits } from './types.js'
import { utf8ByteLength } from './utf8.js'

/** UTF-8 must not silently replace malformed UTF-16 with replacement characters. */
export function wellFormed(text: string): boolean {
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index)
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(index + 1)
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false
			index += 1
		} else if (code >= 0xdc00 && code <= 0xdfff) return false
	}
	return true
}

/** Internal schemas: consumers use the archive API, not a Zod-specific integration contract. */
export function createPayloadSchemas(limits: PayloadLimits) {
	const text = (maximum: number, minimum = 1) =>
		z
			.string()
			.min(minimum)
			.max(maximum)
			.refine(wellFormed)
			.refine((value) => utf8ByteLength(value) <= maximum)
	const name = text(limits.nameBytes)
	const id = text(limits.idBytes)
	const timestamp = z.iso.datetime({ precision: 3 })
	const value = z.discriminatedUnion('kind', [
		z.strictObject({ kind: z.literal('null') }).readonly(),
		z.strictObject({ kind: z.literal('text'), value: text(limits.textBytes, 0) }).readonly(),
		z.strictObject({ kind: z.literal('boolean'), value: z.boolean() }).readonly(),
		z
			.strictObject({
				kind: z.literal('integer'),
				value: z
					.string()
					.max(129)
					.regex(/^(?:0|-?[1-9][0-9]{0,127})$/)
			})
			.readonly(),
		z.strictObject({ kind: z.literal('date'), value: z.iso.date() }).readonly(),
		z.strictObject({ kind: z.literal('timestamp'), value: timestamp }).readonly(),
		z.strictObject({ kind: z.literal('reference'), type: name, id }).readonly(),
		z.strictObject({ kind: z.literal('attachment'), id }).readonly()
	])
	// Zod 4.1.11's z.record skips __proto__. Validate through a Map, then reconstruct own data
	// properties with Object.fromEntries so arbitrary valid field names are preserved exactly.
	const fields = z
		.preprocess(
			(input) =>
				typeof input === 'object' && input !== null && !Array.isArray(input)
					? new Map(Object.entries(input))
					: input,
			z.map(name, value).refine((entries) => entries.size <= limits.fieldsPerRecord)
		)
		.transform((entries) => Object.freeze(Object.fromEntries(entries)))
	const record = z.strictObject({ type: name, id, fields }).readonly()
	const attachment = z
		.strictObject({
			id,
			mediaType: text(limits.textBytes),
			fileName: text(limits.textBytes, 0),
			sizeBytes: z
				.int()
				.min(0)
				.max(limits.attachmentBytes)
				.refine((size) => !Object.is(size, -0)),
			sha256: z.string().regex(/^[0-9a-f]{64}$/),
			// Large base64 strings use the archive's linear-time canonical checker after schema parsing.
			data: z.string().max(Math.ceil(limits.attachmentBytes / 3) * 4)
		})
		.readonly()
	const payload = z
		.strictObject({
			archiveId: z.guid(),
			profile: z.strictObject({ id, version: z.int().positive() }).readonly(),
			source: z.strictObject({ applicationId: id, workspaceId: id }).readonly(),
			capturedAt: timestamp,
			coverage: z
				.strictObject({
					mode: z.literal('complete-supported-graph'),
					recordTypes: z.array(name).min(1).max(limits.records).readonly(),
					history: z.literal('current-data'),
					deletedRecords: z.literal('excluded'),
					consistency: z.enum(['quiescent-single-user', 'jazz-exclusive-transaction'])
				})
				.readonly(),
			records: z.array(record).max(limits.records).readonly(),
			attachments: z.array(attachment).max(limits.attachments).readonly(),
			references: z.array(record).max(limits.records).readonly()
		})
		.readonly()
	return { value, record, attachment, payload }
}
