import { documentReadingStatusSchema } from '../../capture/document-schema.js'
import { schema as s } from 'jazz-tools'
import type { RowRefValue } from 'jazz-tools/permissions'
import { app } from './schema.js'

export default s.definePermissions(app, ({ policy, session, allOf, anyOf }) => {
	policy.better_auth_user.allowRead.never()
	policy.better_auth_user.allowInsert.never()
	policy.better_auth_user.allowUpdate.never()
	policy.better_auth_user.allowDelete.never()

	policy.better_auth_session.allowRead.never()
	policy.better_auth_session.allowInsert.never()
	policy.better_auth_session.allowUpdate.never()
	policy.better_auth_session.allowDelete.never()

	policy.better_auth_account.allowRead.never()
	policy.better_auth_account.allowInsert.never()
	policy.better_auth_account.allowUpdate.never()
	policy.better_auth_account.allowDelete.never()

	policy.better_auth_verification.allowRead.never()
	policy.better_auth_verification.allowInsert.never()
	policy.better_auth_verification.allowUpdate.never()
	policy.better_auth_verification.allowDelete.never()

	policy.better_auth_atprotoSession.allowRead.never()
	policy.better_auth_atprotoSession.allowInsert.never()
	policy.better_auth_atprotoSession.allowUpdate.never()
	policy.better_auth_atprotoSession.allowDelete.never()

	policy.better_auth_atprotoState.allowRead.never()
	policy.better_auth_atprotoState.allowInsert.never()
	policy.better_auth_atprotoState.allowUpdate.never()
	policy.better_auth_atprotoState.allowDelete.never()

	const owns = (libraryId: string | RowRefValue) =>
		policy.libraries.exists.where({ id: libraryId, ownerId: session.user })
	const canonical = () =>
		allOf([{ id: session.user }, { ownerId: session.user }, { bootstrapVersion: '1' }])
	policy.libraries.allowRead.where({ ownerId: session.user })
	policy.libraries.allowInsert.where(canonical)
	policy.libraries.allowUpdate.whereOld(canonical).whereNew(canonical)
	policy.libraries.allowDelete.never()
	const documentParent = (row: { libraryId: RowRefValue; documentId: RowRefValue }) =>
		allOf([
			owns(row.libraryId),
			policy.libraryDocuments.exists.where({ id: row.documentId, libraryId: row.libraryId })
		])
	policy.notes.allowRead.where((row) => owns(row.libraryId))
	policy.notes.allowInsert.where(documentParent)
	policy.notes.allowUpdate.never()
	policy.notes.allowDelete.never()
	policy.noteRevisions.allowRead.where((row) => owns(row.libraryId))
	policy.noteRevisions.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			policy.notes.exists.where({ id: row.noteId, libraryId: row.libraryId })
		])
	)
	policy.noteRevisions.allowUpdate.never()
	policy.noteRevisions.allowDelete.never()
	policy.readerOperations.allowRead.where((row) => owns(row.libraryId))
	policy.readerOperations.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			anyOf(['theme', 'font', 'size', 'spacing', 'width'].map((field) => ({ field })))
		])
	)
	policy.readerOperations.allowUpdate.never()
	policy.readerOperations.allowDelete.never()
	policy.tagOperations.allowRead.where((row) => owns(row.libraryId))
	policy.tagOperations.allowInsert.where(documentParent)
	policy.tagOperations.allowUpdate.never()
	policy.tagOperations.allowDelete.never()
	policy.organizationOperations.allowRead.where((row) => owns(row.libraryId))
	policy.organizationOperations.allowInsert.where((row) =>
		allOf([
			documentParent(row),
			anyOf([
				allOf([
					{ field: 'status' },
					anyOf(documentReadingStatusSchema.options.map((value) => ({ value })))
				]),
				allOf([
					anyOf([{ field: 'favorite' }, { field: 'trashed' }]),
					anyOf([{ value: 'true' }, { value: 'false' }])
				])
			])
		])
	)
	policy.organizationOperations.allowUpdate.never()
	policy.organizationOperations.allowDelete.never()
	const documentState = (row: { libraryId: RowRefValue; attachmentId: RowRefValue }) =>
		allOf([
			owns(row.libraryId),
			anyOf([
				allOf([
					{ status: 'trashed' },
					anyOf(documentReadingStatusSchema.options.map((previousStatus) => ({ previousStatus })))
				]),
				allOf([
					anyOf(documentReadingStatusSchema.options.map((status) => ({ status }))),
					{ previousStatus: null }
				])
			]),
			anyOf([
				{ attachmentId: null },
				policy.articles.exists.where({
					id: row.attachmentId,
					libraryId: row.libraryId
				})
			])
		])
	policy.libraryDocuments.allowRead.where((row) => owns(row.libraryId))
	policy.libraryDocuments.allowInsert.where((row) => documentState(row))
	policy.libraryDocuments.allowUpdate.whereOld((row) => owns(row.libraryId)).whereNew(documentState)
	policy.libraryDocuments.allowDelete.never()
	policy.storageOperations.allowRead.where((row) => owns(row.libraryId))
	policy.storageOperations.allowInsert.where((row) => owns(row.libraryId))
	policy.storageOperations.allowUpdate.never()
	policy.storageOperations.allowDelete.never()
	policy.assets.allowRead.where((row) => owns(row.libraryId))
	policy.assets.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			policy.storageOperations.exists.where({ id: row.operationId, libraryId: row.libraryId })
		])
	)
	policy.assets.allowUpdate.never()
	policy.assets.allowDelete.never()
	policy.sites.allowRead.where((row) => owns(row.libraryId))
	const siteScope = (row: { libraryId: RowRefValue; faviconId: RowRefValue }) =>
		allOf([
			owns(row.libraryId),
			anyOf([
				{ faviconId: null },
				policy.assets.exists.where({ id: row.faviconId, libraryId: row.libraryId })
			])
		])
	policy.sites.allowInsert.where(siteScope)
	policy.sites.allowUpdate.whereOld((row) => owns(row.libraryId)).whereNew(siteScope)
	policy.sites.allowDelete.never()
	policy.articles.allowRead.where((row) => owns(row.libraryId))
	policy.articles.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			policy.storageOperations.exists.where({ id: row.operationId, libraryId: row.libraryId }),
			anyOf([
				{ siteId: null },
				policy.sites.exists.where({ id: row.siteId, libraryId: row.libraryId })
			])
		])
	)
	policy.articles.allowUpdate.never()
	policy.articles.allowDelete.never()
	policy.documentCaptures.allowRead.where((row) => owns(row.libraryId))
	policy.documentCaptures.allowInsert.where((row) => documentParent(row))
	policy.documentCaptures.allowUpdate
		.whereOld((row) => owns(row.libraryId))
		.whereNew((row) => documentParent(row))
	policy.documentCaptures.allowDelete.never()
	const imageParent = (row: { libraryId: RowRefValue; articleId: RowRefValue }) =>
		allOf([
			owns(row.libraryId),
			policy.articles.exists.where({ id: row.articleId, libraryId: row.libraryId })
		])
	policy.articleImages.allowRead.where((row) => owns(row.libraryId))
	policy.articleImages.allowInsert.where((row) =>
		allOf([imageParent(row), { status: 'pending' }, { assetId: null }])
	)
	policy.articleImages.allowUpdate
		.whereOld((row) =>
			allOf([owns(row.libraryId), anyOf([{ status: 'pending' }, { status: 'failed' }])])
		)
		.whereNew((row) =>
			allOf([
				imageParent(row),
				anyOf([
					allOf([{ status: 'failed' }, { assetId: null }]),
					allOf([
						{ status: 'ready' },
						policy.assets.exists.where({ id: row.assetId, libraryId: row.libraryId })
					])
				])
			])
		)
	policy.articleImages.allowDelete.never()
})
