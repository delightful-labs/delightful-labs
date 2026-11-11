import { base64Size } from './binary.js'
import { checkPayloadBudget } from './budget.js'
import { createPayloadSchemas } from './schemas.js'
import { parsePayloadJson } from './json.js'
import { utf8ByteLength } from './utf8.js'
import {
	createArchivePayloadError,
	resolvePayloadLimits,
	type ArchivePayload,
	type ArchiveRecord,
	type PayloadLimitOverrides,
	type PayloadLimits
} from './types.js'

const utf8 = new TextEncoder()

function invalid(): never {
	throw createArchivePayloadError('invalidPayload')
}

function dictionary(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

function compareRecord(left: ArchiveRecord, right: ArchiveRecord): number {
	return compare(left.type, right.type) || compare(left.id, right.id)
}

/** Validate and detach caller data. Hashes, domain policy and source completeness are NOT checked. */
function normalize(input: unknown, limits: PayloadLimits): ArchivePayload {
	checkPayloadBudget(input, limits)
	const result = createPayloadSchemas(limits).payload.safeParse(input)
	// Never expose Zod issues, paths or input values through public errors or logs.
	if (!result.success) throw createArchivePayloadError('invalidPayload')
	const payload = result.data
	if (payload.records.length + payload.references.length > limits.records)
		throw createArchivePayloadError('limitExceeded')
	const recordTypes = new Set(payload.coverage.recordTypes)
	if (recordTypes.size !== payload.coverage.recordTypes.length) return invalid()
	const identities = new Map<string, Set<string>>()
	const allRecords = [...payload.records, ...payload.references]
	for (const row of allRecords) {
		if (!recordTypes.has(row.type)) return invalid()
		const ids = identities.get(row.type) ?? new Set<string>()
		if (ids.has(row.id)) throw createArchivePayloadError('duplicateIdentity')
		ids.add(row.id)
		identities.set(row.type, ids)
	}
	let totalAttachmentBytes = 0
	const attachmentIds = new Set<string>()
	for (const file of payload.attachments) {
		if (attachmentIds.has(file.id)) throw createArchivePayloadError('duplicateIdentity')
		attachmentIds.add(file.id)
		const size = base64Size(file.data, limits.attachmentBytes)
		if (size !== file.sizeBytes) return invalid()
		totalAttachmentBytes += size
		if (totalAttachmentBytes > limits.totalAttachmentBytes)
			throw createArchivePayloadError('limitExceeded')
	}
	for (const row of allRecords) {
		for (const entry of Object.values(row.fields)) {
			if (entry.kind === 'reference' && !identities.get(entry.type)?.has(entry.id))
				throw createArchivePayloadError('brokenReference')
			if (entry.kind === 'attachment' && !attachmentIds.has(entry.id))
				throw createArchivePayloadError('brokenReference')
		}
	}
	return Object.freeze({
		...payload,
		coverage: Object.freeze({
			...payload.coverage,
			recordTypes: Object.freeze([...payload.coverage.recordTypes].sort(compare))
		}),
		records: Object.freeze([...payload.records].sort(compareRecord)),
		references: Object.freeze([...payload.references].sort(compareRecord)),
		attachments: Object.freeze(
			[...payload.attachments].sort((left, right) => compare(left.id, right.id))
		)
	})
}

/** Serialize sorted keys explicitly: JSON.stringify reorders integer-like field names. */
function serialize(payload: ArchivePayload, limits: PayloadLimits): Uint8Array<ArrayBuffer> {
	const parts: string[] = []
	let bytes = 0
	let values = 0
	function append(part: string) {
		bytes += utf8ByteLength(part)
		if (bytes > limits.payloadBytes) throw createArchivePayloadError('limitExceeded')
		parts.push(part)
	}
	function visit(value: unknown, depth: number) {
		values += 1
		if (depth > limits.depth || values > limits.jsonValues)
			throw createArchivePayloadError('limitExceeded')
		if (
			value === null ||
			typeof value === 'string' ||
			typeof value === 'number' ||
			typeof value === 'boolean'
		) {
			append(JSON.stringify(value))
			return
		}
		if (Array.isArray(value)) {
			append('[')
			value.forEach((item: unknown, index) => {
				if (index > 0) append(',')
				visit(item, depth + 1)
			})
			append(']')
			return
		}
		if (!dictionary(value)) return invalid()
		append('{')
		Object.keys(value)
			.sort(compare)
			.forEach((key, index) => {
				if (index > 0) append(',')
				append(JSON.stringify(key))
				append(':')
				visit(value[key], depth + 1)
			})
		append('}')
	}
	visit(payload, 1)
	return utf8.encode(parts.join(''))
}

/** Parse bounded UTF-8 JSON; rejects BOM, duplicate keys and unsupported generic structures. */
export function parseArchivePayload(
	bytes: Uint8Array,
	overrides: PayloadLimitOverrides = {}
): ArchivePayload {
	const limits = resolvePayloadLimits(overrides)
	if (bytes.byteLength > limits.payloadBytes) throw createArchivePayloadError('limitExceeded')
	let source: string
	try {
		source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
	} catch {
		throw createArchivePayloadError('invalidEncoding')
	}
	if (source.charCodeAt(0) === 0xfeff) throw createArchivePayloadError('invalidEncoding')
	return normalize(parsePayloadJson(source, limits), limits)
}

/** Validate caller data, then emit deterministic UTF-8 JSON. Does not create an envelope. */
export function encodeArchivePayload(
	input: unknown,
	overrides: PayloadLimitOverrides = {}
): Uint8Array<ArrayBuffer> {
	return prepareArchivePayload(input, overrides).bytes
}

/** Internal preparation keeps the validated graph paired with its bounded encoding. */
export function prepareArchivePayload(input: unknown, overrides: PayloadLimitOverrides = {}) {
	const limits = resolvePayloadLimits(overrides)
	const payload = normalize(input, limits)
	return { payload, bytes: serialize(payload, limits) }
}
