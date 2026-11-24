import { app } from './jazz.generated.js'
/** All user-record readers consume named native joins, never an attachment-ID lookup. */
export const documentsQuery = app.libraryDocuments.select('*', '$createdAt').include({
	library: true,
	attachment: { site: { favicon: true } },
	captures: true
})
export const articlesQuery = app.articles.include({ site: { favicon: true } })

// A reverse relation can still be empty while a document is arriving. Starting
// from its capture metadata keeps the live observer valid until both are local.
export const capturedDocumentsQuery = app.documentCaptures
	.include({ document: documentsQuery.requireIncludes() })
	.requireIncludes()

export const pendingCapturedDocumentsQuery = app.documentCaptures
	.include({ document: documentsQuery.where({ attachmentId: null }).requireIncludes() })
	.requireIncludes()
