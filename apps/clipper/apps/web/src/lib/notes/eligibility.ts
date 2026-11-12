import type { Note, NoteRevision } from './schema.js'

export type NoteAssociation = {
	library: unknown
	document: unknown
	documentId: string
	notes: readonly Note[]
}
export type NoteRevisionRows = { note: Note | null; history: readonly NoteRevision[] }
export function belongsToDocument(note: Note, documentId: string) {
	return note.documentId === documentId
}
export function hasNoteParent(rows: NoteAssociation) {
	return !!rows.library && !!rows.document
}
export function hasNoteForDocument(rows: NoteAssociation) {
	return rows.notes.some((note) => belongsToDocument(note, rows.documentId))
}
export function hasUnusedNoteId(notes: readonly Note[], id: string) {
	return !notes.some((note) => note.id === id)
}
export function hasUnusedRevisionId(knownIds: ReadonlySet<string>, id: string) {
	return !knownIds.has(id)
}
export function matchesNoteOperation(
	record: Pick<Note, 'id' | 'libraryId'>,
	libraryId: string,
	operationId: string
) {
	return record.libraryId === libraryId && record.id === operationId
}
export function hasKnownRevisionParents(revision: NoteRevision, knownIds: ReadonlySet<string>) {
	return revision.parents.every((id) => knownIds.has(id))
}
function revisionIdsForNote(history: readonly NoteRevision[], noteId: string) {
	return history.filter((revision) => revision.noteId === noteId).map((revision) => revision.id)
}
export function canCreateNote(rows: NoteAssociation, noteId: string) {
	return hasNoteParent(rows) && !hasNoteForDocument(rows) && hasUnusedNoteId(rows.notes, noteId)
}
export function canWriteNoteRevision(rows: NoteRevisionRows, revision: NoteRevision) {
	if (!rows.note) return false
	if (!hasUnusedRevisionId(new Set(rows.history.map((row) => row.id)), revision.id)) return false
	return hasKnownRevisionParents(
		revision,
		new Set(revisionIdsForNote(rows.history, revision.noteId))
	)
}
