import { z } from 'zod'
import type { createPayloadSchemas } from './schemas.js'

// Shapes have one source of truth: the internal schemas. No consumer-owned Zod schemas required.
type PayloadSchemas = ReturnType<typeof createPayloadSchemas>
export type ArchiveValue = z.output<PayloadSchemas['value']>
export type ArchiveRecord = z.output<PayloadSchemas['record']>
export type ArchiveAttachment = z.output<PayloadSchemas['attachment']>
export type ArchivePayload = z.output<PayloadSchemas['payload']>

export const payloadLimits = Object.freeze({
	payloadBytes: 32 * 1024 * 1024,
	attachmentBytes: 8 * 1024 * 1024,
	totalAttachmentBytes: 16 * 1024 * 1024,
	records: 50_000,
	attachments: 5_000,
	depth: 32,
	textBytes: 1024 * 1024,
	nameBytes: 128,
	idBytes: 256,
	fieldsPerRecord: 256,
	jsonValues: 500_000
})

export type PayloadLimits = { readonly [Key in keyof typeof payloadLimits]: number }
export type PayloadLimitOverrides = Partial<PayloadLimits>

export type ArchivePayloadErrorCode =
	| 'limitExceeded'
	| 'invalidEncoding'
	| 'invalidJson'
	| 'duplicateKey'
	| 'invalidPayload'
	| 'duplicateIdentity'
	| 'brokenReference'

/** Codes are safe to log. Messages never interpolate input values, IDs or record content. */
export class ArchivePayloadError extends Error {
	readonly code: ArchivePayloadErrorCode

	constructor(code: ArchivePayloadErrorCode) {
		super(code)
		this.name = 'ArchivePayloadError'
		this.code = code
	}
}

/** Consumers may reduce limits, never raise or disable the v1 bounds. */
export function resolvePayloadLimits(overrides: PayloadLimitOverrides = {}): PayloadLimits {
	function limit(value: number | undefined, maximum: number) {
		if (value === undefined) return maximum
		if (!z.int().min(1).max(maximum).safeParse(value).success)
			throw new ArchivePayloadError('limitExceeded')
		return value
	}
	return Object.freeze({
		payloadBytes: limit(overrides.payloadBytes, payloadLimits.payloadBytes),
		attachmentBytes: limit(overrides.attachmentBytes, payloadLimits.attachmentBytes),
		totalAttachmentBytes: limit(overrides.totalAttachmentBytes, payloadLimits.totalAttachmentBytes),
		records: limit(overrides.records, payloadLimits.records),
		attachments: limit(overrides.attachments, payloadLimits.attachments),
		depth: limit(overrides.depth, payloadLimits.depth),
		textBytes: limit(overrides.textBytes, payloadLimits.textBytes),
		nameBytes: limit(overrides.nameBytes, payloadLimits.nameBytes),
		idBytes: limit(overrides.idBytes, payloadLimits.idBytes),
		fieldsPerRecord: limit(overrides.fieldsPerRecord, payloadLimits.fieldsPerRecord),
		jsonValues: limit(overrides.jsonValues, payloadLimits.jsonValues)
	})
}
