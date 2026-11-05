import { checkPayloadBudget } from './budget.js'
import { parsePayloadJson } from './json.js'
import { isArchivePayloadError, resolvePayloadLimits } from './types.js'
import {
	restoreIntentSchema,
	restoreJournalLimits,
	restoreJournalSchema,
	type RestoreJournalIntent,
	type RestoreJournalRecord
} from './restore-journal-schemas.js'

export type RestoreJournalErrorCode =
	| 'invalidJournal'
	| 'invalidJournalEncoding'
	| 'unsupportedJournalVersion'
	| 'journalLimitExceeded'
export function createRestoreJournalError(code: RestoreJournalErrorCode) {
	return Object.assign(new Error(code), { name: 'RestoreJournalError', code })
}
export function isRestoreJournalErrorCode(code: unknown): code is RestoreJournalErrorCode {
	return (
		code === 'invalidJournal' ||
		code === 'invalidJournalEncoding' ||
		code === 'unsupportedJournalVersion' ||
		code === 'journalLimitExceeded'
	)
}
export function isRestoreJournalError(
	error: unknown
): error is ReturnType<typeof createRestoreJournalError> {
	return (
		error instanceof Error &&
		error.name === 'RestoreJournalError' &&
		'code' in error &&
		isRestoreJournalErrorCode(error.code)
	)
}

const limits = resolvePayloadLimits({
	payloadBytes: restoreJournalLimits.bytes,
	jsonValues: restoreJournalLimits.jsonValues,
	depth: restoreJournalLimits.depth
})
const utf8 = new TextEncoder()
// Only codec-produced deeply frozen values qualify. No serialized strings/bytes are retained.
const records = new WeakSet<object>()
const intents = new WeakSet<object>()
function knownRecord(input: unknown): input is RestoreJournalRecord {
	return typeof input === 'object' && input !== null && records.has(input)
}
function knownIntent(input: unknown): input is RestoreJournalIntent {
	return typeof input === 'object' && input !== null && intents.has(input)
}
function bounded<T>(run: () => T): T {
	try {
		return run()
	} catch (error) {
		if (isRestoreJournalError(error)) throw error
		if (isArchivePayloadError(error) && error.code === 'limitExceeded')
			throw createRestoreJournalError('journalLimitExceeded')
		throw createRestoreJournalError('invalidJournal')
	}
}
function intent(input: unknown): RestoreJournalIntent {
	if (knownIntent(input)) return input
	const value = bounded(() => {
		checkPayloadBudget(input, limits)
		const result = restoreIntentSchema.safeParse(input)
		if (!result.success) throw createRestoreJournalError('invalidJournal')
		// Track only detached immutable output, independently of caller-owned input behavior.
		checkPayloadBudget(result.data, limits)
		return result.data
	})
	intents.add(value)
	return value
}
function validatedRecord(input: unknown): RestoreJournalRecord {
	return bounded(() => {
		checkPayloadBudget(input, limits)
		if (
			typeof input === 'object' &&
			input !== null &&
			!Array.isArray(input) &&
			Object.hasOwn(input, 'version') &&
			'version' in input &&
			typeof input.version === 'number' &&
			Number.isSafeInteger(input.version) &&
			input.version > 1
		)
			throw createRestoreJournalError('unsupportedJournalVersion')
		const result = restoreJournalSchema.safeParse(input)
		if (!result.success) throw createRestoreJournalError('invalidJournal')
		checkPayloadBudget(result.data, limits)
		return result.data
	})
}
function serialize(value: RestoreJournalRecord) {
	const json = JSON.stringify(value)
	const bytes = utf8.encode(json)
	if (bytes.byteLength > restoreJournalLimits.bytes) {
		bytes.fill(0)
		throw createRestoreJournalError('journalLimitExceeded')
	}
	return bytes
}
/**
 * Detach/validate unknown metadata; already-normalized immutable outputs may be returned by identity.
 * A successful parse supplies no identity, authority or write grant.
 */
export function parseRestoreJournalRecord(input: unknown): RestoreJournalRecord {
	if (knownRecord(input)) return input
	const record = validatedRecord(input)
	const bytes = serialize(record)
	bytes.fill(0)
	records.add(record)
	intents.add(record.intent)
	return record
}
/** Proposed initial metadata, not a durably created operation. Persist before destination effects. */
export function createRestoreJournalRecord(input: unknown): RestoreJournalRecord {
	const value = intent(input)
	return parseRestoreJournalRecord({
		format: 'DLF-RESTORE-JOURNAL',
		version: 1,
		revision: 0,
		intent: value,
		checkpoint: {
			kind: 'writing',
			completed: [],
			current: {
				status: 'notIssued',
				writeId: value.plan.preparation.writeId,
				issuance: 0
			}
		}
	})
}
/** Complete intent comparison. Expected metadata must come from trusted profile/recovery logic. */
export function matchRestoreJournalIntent(input: unknown, expected: unknown): boolean {
	const stored = parseRestoreJournalRecord(input)
	return JSON.stringify(stored.intent) === JSON.stringify(intent(expected))
}
/** Fresh owned UTF-8 bytes in stable schema-key order; no digest proof is claimed. */
export function encodeRestoreJournalRecord(input: unknown): Uint8Array<ArrayBuffer> {
	return serialize(knownRecord(input) ? input : validatedRecord(input))
}
/** Strict, bounded UTF-8/JSON; unsupported and malformed records are rejected without repair. */
export function decodeRestoreJournalRecord(bytes: Uint8Array): RestoreJournalRecord {
	if (bytes.byteLength > restoreJournalLimits.bytes)
		throw createRestoreJournalError('journalLimitExceeded')
	let raw: unknown
	try {
		const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
		if (text.startsWith('\ufeff')) throw createRestoreJournalError('invalidJournalEncoding')
		raw = parsePayloadJson(text, limits)
	} catch (error) {
		if (isRestoreJournalError(error)) throw error
		if (isArchivePayloadError(error) && error.code === 'limitExceeded')
			throw createRestoreJournalError('journalLimitExceeded')
		throw createRestoreJournalError('invalidJournalEncoding')
	}
	return parseRestoreJournalRecord(raw)
}

export { restoreJournalLimits } from './restore-journal-schemas.js'
export type {
	RestoreJournalIntent,
	RestoreJournalRecord,
	RestoreJournalCheckpoint,
	RestoreJournalAttempt,
	RestoreJournalCompletion,
	RestoreJournalReceipt
} from './restore-journal-schemas.js'
