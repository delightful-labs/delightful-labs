import { checkPayloadBudget } from './budget.js'
import { createPayloadSchemas } from './schemas.js'
import { parsePayloadJson } from './json.js'
import {
	ArchivePayloadError,
	resolvePayloadLimits,
	type ArchivePayload,
	type ArchiveRecord,
	type PayloadLimitOverrides,
	type PayloadLimits
} from './types.js'

const utf8 = new TextEncoder()
const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function invalid(): never {
	throw new ArchivePayloadError('invalidPayload')
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

/** Checks canonical alphabet, padding and pad bits, and obtains byte size before decoding. */
function base64Size(value: string, maximum: number): number {
	if (value.length > Math.ceil(maximum / 3) * 4) throw new ArchivePayloadError('limitExceeded')
	if (value.length % 4 !== 0) return invalid()
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
	const end = value.length - padding
	for (let index = 0; index < end; index += 1) {
		if (!base64Alphabet.includes(value.charAt(index))) return invalid()
	}
	const last = base64Alphabet.indexOf(value.charAt(end - 1))
	if ((padding === 2 && last % 16 !== 0) || (padding === 1 && last % 4 !== 0)) return invalid()
	const size = (value.length / 4) * 3 - padding
	if (size > maximum) throw new ArchivePayloadError('limitExceeded')
	return size
}

/** Validate and detach caller data. Hashes, domain policy and source completeness are NOT checked. */
function normalize(input: unknown, limits: PayloadLimits): ArchivePayload {
	checkPayloadBudget(input, limits)
	const result = createPayloadSchemas(limits).payload.safeParse(input)
	// Never expose Zod issues, paths or input values through public errors or logs.
	if (!result.success) throw new ArchivePayloadError('invalidPayload')
	const payload = result.data
	if (payload.records.length + payload.references.length > limits.records)
		throw new ArchivePayloadError('limitExceeded')
	const recordTypes = new Set(payload.coverage.recordTypes)
	if (recordTypes.size !== payload.coverage.recordTypes.length) return invalid()
	const identities = new Map<string, Set<string>>()
	const allRecords = [...payload.records, ...payload.references]
	for (const row of allRecords) {
		if (!recordTypes.has(row.type)) return invalid()
		const ids = identities.get(row.type) ?? new Set<string>()
		if (ids.has(row.id)) throw new ArchivePayloadError('duplicateIdentity')
		ids.add(row.id)
		identities.set(row.type, ids)
	}
	let totalAttachmentBytes = 0
	const attachmentIds = new Set<string>()
	for (const file of payload.attachments) {
		if (attachmentIds.has(file.id)) throw new ArchivePayloadError('duplicateIdentity')
		attachmentIds.add(file.id)
		const size = base64Size(file.data, limits.attachmentBytes)
		if (size !== file.sizeBytes) return invalid()
		totalAttachmentBytes += size
		if (totalAttachmentBytes > limits.totalAttachmentBytes)
			throw new ArchivePayloadError('limitExceeded')
	}
	for (const row of allRecords) {
		for (const entry of Object.values(row.fields)) {
			if (entry.kind === 'reference' && !identities.get(entry.type)?.has(entry.id))
				throw new ArchivePayloadError('brokenReference')
			if (entry.kind === 'attachment' && !attachmentIds.has(entry.id))
				throw new ArchivePayloadError('brokenReference')
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
		bytes += utf8.encode(part).length
		if (bytes > limits.payloadBytes) throw new ArchivePayloadError('limitExceeded')
		parts.push(part)
	}
	function visit(value: unknown, depth: number) {
		values += 1
		if (depth > limits.depth || values > limits.jsonValues)
			throw new ArchivePayloadError('limitExceeded')
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
	if (bytes.byteLength > limits.payloadBytes) throw new ArchivePayloadError('limitExceeded')
	let source: string
	try {
		source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
	} catch {
		throw new ArchivePayloadError('invalidEncoding')
	}
	if (source.charCodeAt(0) === 0xfeff) throw new ArchivePayloadError('invalidEncoding')
	return normalize(parsePayloadJson(source, limits), limits)
}

/** Validate caller data, then emit deterministic UTF-8 JSON. Does not create an envelope. */
export function encodeArchivePayload(
	input: unknown,
	overrides: PayloadLimitOverrides = {}
): Uint8Array<ArrayBuffer> {
	const limits = resolvePayloadLimits(overrides)
	return serialize(normalize(input, limits), limits)
}
