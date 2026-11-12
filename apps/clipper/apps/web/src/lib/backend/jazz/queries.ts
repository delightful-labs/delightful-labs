import { app } from './schema.js'
/** All user-record readers consume named native joins, never an attachment-ID lookup. */
export const documentsQuery = app.libraryDocuments.select('*', '$createdAt').include({
	library: true,
	attachment: { site: { favicon: true } },
	captures: true
})
export const articlesQuery = app.articles.include({ site: { favicon: true } })
