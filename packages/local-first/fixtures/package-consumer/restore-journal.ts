import {
	createRestoreJournalRecord,
	decodeRestoreJournalRecord,
	encodeRestoreJournalRecord,
	matchRestoreJournalIntent,
	type RestoreJournalIntent,
	type RestoreJournalCompletion,
	type RestoreJournalReceipt,
	type RestoreJournalAttempt,
	type RestoreJournalRecord
} from 'delightful-local-first/backup/restore/journal'

// Declaration/consumer checks only. This fixture does not execute journal helpers or storage I/O.
export function encodeInitialRestoreIntent(intent: RestoreJournalIntent): Uint8Array<ArrayBuffer> {
	return encodeRestoreJournalRecord(createRestoreJournalRecord(intent))
}
export function decodeExpectedRestoreRecord(
	bytes: Uint8Array,
	intent: RestoreJournalIntent
): {
	record: RestoreJournalRecord
	matchingIntent: boolean
} {
	const record = decodeRestoreJournalRecord(bytes)
	return { record, matchingIntent: matchRestoreJournalIntent(record, intent) }
}

// Static examples for the additional inferred public types; no storage or workflow is executed.
export function completionAttempt(value: RestoreJournalCompletion): RestoreJournalReceipt {
	return 'basis' in value ? value.attempt : value
}
export function rejectedAttempt(value: RestoreJournalReceipt): RestoreJournalAttempt | undefined {
	return value.lastRejectedAttempt
}
