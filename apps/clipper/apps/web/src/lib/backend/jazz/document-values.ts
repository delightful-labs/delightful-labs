import { newDocument } from '../../capture/document-schema.js'
import type { CaptureDocument } from '../../capture/capture-document-schema.js'
/** Persistence-only backing columns; callers read the named relationships. */
export function newDocumentValues(id: string, libraryId: string, sourceUrl: string | null) {
	const document = newDocument(id, libraryId, sourceUrl)
	return {
		libraryId,
		sourceUrl: document.sourceUrl,
		readingProgress: document.readingProgress,
		resumePosition: document.resumePosition,
		status: document.status,
		favorite: document.favorite,
		attachmentId: null
	}
}
/** Native columns only; capture metadata is written to documentCaptures separately. */
export function documentValues(document: CaptureDocument) {
	return {
		libraryId: document.library.id,
		sourceUrl: document.sourceUrl,
		readingProgress: document.readingProgress,
		resumePosition: document.resumePosition,
		status: document.status,
		favorite: document.favorite,
		previousStatus: document.status === 'trashed' ? document.previousStatus : null,
		attachmentId: document.attachment?.id ?? null
	}
}
