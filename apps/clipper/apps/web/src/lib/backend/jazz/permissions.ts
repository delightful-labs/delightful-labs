import type { schema as s } from 'jazz-tools'
import { schema } from './schema.js'

const { definePermissions, exists, session, anyOf, allOf } = schema

const ownerIsMe = { ownerId: session.user }

const isMyLibrary = (libraryId: s.Uuid) =>
	exists.libraries({ id: libraryId, ownerId: session.user })

const articleMatches = (articleId: s.Uuid, libraryId: s.Uuid) =>
	exists.articles({ id: articleId, libraryId })

const ownedArticle = (libraryId: s.Uuid, articleId: s.Uuid) =>
	allOf(isMyLibrary(libraryId), articleMatches(articleId, libraryId))

const assetMatches = (assetId: s.Uuid, libraryId: s.Uuid) =>
	exists.assets({ id: assetId, libraryId })

const storageOperationMatches = (operationId: s.Uuid, libraryId: s.Uuid) =>
	exists.storageOperations({ id: operationId, libraryId })

const libraryDocumentMatches = (documentId: s.Uuid, libraryId: s.Uuid) =>
	exists.libraryDocuments({ id: documentId, libraryId })

const ownedDocument = (libraryId: s.Uuid, documentId: s.Uuid) =>
	allOf(isMyLibrary(libraryId), libraryDocumentMatches(documentId, libraryId))

const ownedHighlight = (highlightId: s.Uuid) =>
	exists.highlights({ id: highlightId, libraryId: session.user })

const validLibraryDocument = (libraryId: s.Uuid, attachmentId: s.Uuid) =>
	allOf(
		isMyLibrary(libraryId),
		anyOf(
			allOf(
				{ status: 'trashed' },
				anyOf(
					{ previousStatus: 'inbox' },
					{ previousStatus: 'later' },
					{ previousStatus: 'archive' }
				)
			),
			allOf(anyOf({ status: 'inbox' }, { status: 'later' }, { status: 'archive' }), {
				previousStatus: null
			})
		),
		anyOf({ attachmentId: null }, articleMatches(attachmentId, libraryId))
	)

const validNoteParent = (libraryId: s.Uuid, documentId: s.Uuid, highlightId: s.Uuid) =>
	allOf(
		ownedDocument(libraryId, documentId),
		anyOf({ highlightId: null }, exists.highlights({ id: highlightId, libraryId, documentId }))
	)

const validSite = (libraryId: s.Uuid, faviconId: s.Uuid) =>
	allOf(isMyLibrary(libraryId), anyOf({ faviconId: null }, assetMatches(faviconId, libraryId)))

export const permissions = definePermissions({
	articleImages: {
		read: (articleImage) => isMyLibrary(articleImage.libraryId),
		insert: (articleImage) =>
			allOf(
				ownedArticle(articleImage.libraryId, articleImage.articleId),
				{ status: 'pending' },
				{ assetId: null }
			),
		updateIf: (articleImage) =>
			allOf(
				isMyLibrary(articleImage.libraryId),
				anyOf({ status: 'pending' }, { status: 'failed' })
			),
		updateTo: (articleImage) =>
			allOf(
				ownedArticle(articleImage.libraryId, articleImage.articleId),
				anyOf(
					{ status: 'failed', assetId: null },
					allOf({ status: 'ready' }, assetMatches(articleImage.assetId, articleImage.libraryId))
				)
			),
		delete: false
	},
	articles: {
		read: (article) => isMyLibrary(article.libraryId),
		insert: (article) =>
			allOf(
				isMyLibrary(article.libraryId),
				storageOperationMatches(article.operationId, article.libraryId),
				anyOf({ siteId: null }, article.site.where({ libraryId: article.libraryId }))
			),
		update: false,
		delete: false
	},
	assets: {
		read: (asset) => isMyLibrary(asset.libraryId),
		insert: (asset) =>
			allOf(
				isMyLibrary(asset.libraryId),
				storageOperationMatches(asset.operationId, asset.libraryId)
			),
		update: false,
		delete: false
	},
	better_auth_account: {
		read: false,
		insert: false,
		update: false,
		delete: false
	},
	better_auth_atprotoSession: {
		read: false,
		insert: false,
		update: false,
		delete: false
	},
	better_auth_atprotoState: {
		read: false,
		insert: false,
		update: false,
		delete: false
	},
	better_auth_session: {
		read: false,
		insert: false,
		update: false,
		delete: false
	},
	better_auth_user: {
		read: false,
		insert: false,
		update: false,
		delete: false
	},
	better_auth_verification: {
		read: false,
		insert: false,
		update: false,
		delete: false
	},
	documentCaptures: {
		read: (documentCapture) => isMyLibrary(documentCapture.libraryId),
		insert: (documentCapture) =>
			ownedDocument(documentCapture.libraryId, documentCapture.documentId),
		updateIf: (documentCapture) => isMyLibrary(documentCapture.libraryId),
		updateTo: (documentCapture) =>
			ownedDocument(documentCapture.libraryId, documentCapture.documentId),
		delete: false
	},
	highlightAnchors: {
		read: (highlightAnchor) => ownedHighlight(highlightAnchor.highlightId),
		insert: (highlightAnchor) => ownedHighlight(highlightAnchor.highlightId),
		update: false,
		delete: false
	},
	highlights: {
		read: (highlight) => isMyLibrary(highlight.libraryId),
		insert: (highlight) => ownedDocument(highlight.libraryId, highlight.documentId),
		update: (highlight) => ownedDocument(highlight.libraryId, highlight.documentId),
		delete: (highlight) => ownedDocument(highlight.libraryId, highlight.documentId)
	},
	libraries: {
		read: ownerIsMe,
		insert: { id: session.user, ownerId: session.user, bootstrapVersion: '1' },
		update: { id: session.user, ownerId: session.user, bootstrapVersion: '1' },
		delete: false
	},
	libraryDocuments: {
		read: (libraryDocument) => isMyLibrary(libraryDocument.libraryId),
		insert: (libraryDocument) =>
			validLibraryDocument(libraryDocument.libraryId, libraryDocument.attachmentId),
		updateIf: (libraryDocument) => isMyLibrary(libraryDocument.libraryId),
		updateTo: (libraryDocument) =>
			validLibraryDocument(libraryDocument.libraryId, libraryDocument.attachmentId),
		delete: false
	},
	noteRevisions: {
		read: (noteRevision) => isMyLibrary(noteRevision.libraryId),
		insert: (noteRevision) =>
			allOf(
				isMyLibrary(noteRevision.libraryId),
				noteRevision.note.where({ libraryId: noteRevision.libraryId })
			),
		update: false,
		delete: false
	},
	notes: {
		read: (note) => isMyLibrary(note.libraryId),
		insert: (note) => validNoteParent(note.libraryId, note.documentId, note.highlightId),
		update: (note) => validNoteParent(note.libraryId, note.documentId, note.highlightId),
		delete: (note) => validNoteParent(note.libraryId, note.documentId, note.highlightId)
	},
	organizationOperations: {
		read: (organizationOperation) => isMyLibrary(organizationOperation.libraryId),
		insert: (organizationOperation) =>
			allOf(
				ownedDocument(organizationOperation.libraryId, organizationOperation.documentId),
				anyOf(
					allOf(
						{ field: 'status' },
						anyOf({ value: 'inbox' }, { value: 'later' }, { value: 'archive' })
					),
					allOf(
						anyOf({ field: 'favorite' }, { field: 'trashed' }),
						anyOf({ value: 'true' }, { value: 'false' })
					)
				)
			),
		update: false,
		delete: false
	},
	publications: {
		read: (publicationLink) => isMyLibrary(publicationLink.libraryId),
		insert: false,
		update: false,
		delete: false
	},
	readerOperations: {
		read: (readerOperation) => isMyLibrary(readerOperation.libraryId),
		insert: (readerOperation) =>
			allOf(
				isMyLibrary(readerOperation.libraryId),
				anyOf(
					{ field: 'theme' },
					{ field: 'font' },
					{ field: 'size' },
					{ field: 'spacing' },
					{ field: 'width' }
				)
			),
		update: false,
		delete: false
	},
	sites: {
		read: (site) => isMyLibrary(site.libraryId),
		insert: (site) => validSite(site.libraryId, site.faviconId),
		updateIf: (site) => isMyLibrary(site.libraryId),
		updateTo: (site) => validSite(site.libraryId, site.faviconId),
		delete: false
	},
	storageOperations: {
		read: (storageOperation) => isMyLibrary(storageOperation.libraryId),
		insert: (storageOperation) => isMyLibrary(storageOperation.libraryId),
		update: false,
		delete: false
	},
	tagOperations: {
		read: (tagOperation) => isMyLibrary(tagOperation.libraryId),
		insert: (tagOperation) => ownedDocument(tagOperation.libraryId, tagOperation.documentId),
		update: false,
		delete: false
	}
})
