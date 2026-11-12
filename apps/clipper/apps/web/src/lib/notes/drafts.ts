import { noteDraftRecordSchema } from './schema.js'
import type { NoteDraftRecord, NoteTarget } from './schema.js'
import { draftTransaction, readDraftRequest } from './draft-database.js'
import { runDraftMutation } from './draft-mutation-machine.js'
import type { DraftEntry } from './draft-mutation-machine.js'
import { readScopedDrafts } from './draft-recovery.js'

export type NoteDraftStore = {
	read: (target: NoteTarget) => Promise<NoteDraftRecord[]>
	write: (record: NoteDraftRecord) => Promise<void>
	remove: (record: NoteDraftRecord) => Promise<void>
}
/** Authored recovery data, not a disposable cache. Deployment/account/note and
 * per-editor keys prevent another tab or account from overwriting a draft.
 * Resolve writes only from transaction completion, never request success. */
export function createNoteDraftStore(namespace: string, libraryId: string): NoteDraftStore {
	function targetKey(target: NoteTarget) {
		if (target.libraryId !== libraryId) throw new Error('Invalid note draft scope')
		return JSON.stringify([namespace, libraryId, target.noteId])
	}
	function entry(value: NoteDraftRecord): DraftEntry {
		const record = noteDraftRecordSchema.parse(value)
		return {
			key: JSON.stringify([namespace, libraryId, record.draft.noteId, record.writerId]),
			target: targetKey(record.draft),
			record
		}
	}
	return {
		read: (target) =>
			draftTransaction('readonly', ({ notes }, result) => {
				readDraftRequest(notes.index('target').getAll(targetKey(target)), notes, (value) =>
					result(readScopedDrafts(value, target))
				)
			}),
		write: (record) =>
			draftTransaction<void>('readwrite', ({ notes }) => {
				notes.put(entry(record))
			}),
		remove: async (record) => {
			await runDraftMutation({ kind: 'remove', entry: entry(record) })
		}
	}
}
