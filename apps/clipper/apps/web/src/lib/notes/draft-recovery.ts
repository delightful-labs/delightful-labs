import { z } from 'zod'
import { noteDraftRecordSchema, sameNote, acknowledgesNoteDraft } from './schema.js'
import type { NoteDraftRecord, NoteTarget } from './schema.js'
const storedDraftSchema = z.object({ record: noteDraftRecordSchema })
export function matchesDraftRecord(current: NoteDraftRecord, expected: NoteDraftRecord) {
	return (
		current.writerId === expected.writerId && acknowledgesNoteDraft(current.draft, expected.draft)
	)
}
export function readScopedDrafts(value: unknown, target: NoteTarget) {
	const records = z
		.array(storedDraftSchema)
		.parse(value)
		.map((row) => row.record)
	if (!records.every((record) => sameNote(record.draft, target)))
		throw new Error('Invalid note draft scope')
	return records
}
export function isStoredDraft(value: unknown) {
	return storedDraftSchema.safeParse(value).success
}
export function matchesStoredDraft(value: unknown, expected: NoteDraftRecord) {
	const parsed = storedDraftSchema.safeParse(value)
	return parsed.success && matchesDraftRecord(parsed.data.record, expected)
}
