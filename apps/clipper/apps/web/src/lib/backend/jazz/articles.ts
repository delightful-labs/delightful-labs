import { documentValues } from './document-values.js'
import { createOrganizationRecords } from './organization.js'
import {
	createArticleEnsureDomain,
	createArticleAttachmentDomain,
	createArticleFailureDomain
} from '../../machines/storage/article-domains.js'
import type { ArticleFailure } from '../../machines/storage/article-domains.js'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import { createActor } from 'xstate'
import { createArticleCollectionMachine } from '../../machines/capture/article-collection.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'

import { createSaveArticleMachine } from '../../machines/storage/save-article.js'
import { articleSchema } from '../../capture/article-schema.js'
import { articlesQuery } from './queries.js'
import { prepareArticle, uuid } from '../../capture/articles.js'
import { captureDocumentRecord } from './document-record.js'
import type { CaptureDocument, ArticleDraft, LibraryArticle } from '../../contracts/articles.js'

import { app } from './schema.js'
import { documentsQuery } from './queries.js'
/** Reads stay bound to this DB/library; owning actors gate admission and late-result consumption.
 * Native write admission and commit scope protection live in transactionLifecycle. */
export function createArticleRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean,
	content: import('../../contracts/articles.js').ContentOperation
) {
	const read = async (id: string) => {
		const row = await db.one(documentsQuery.where({ id: uuid(id), libraryId }), {
			tier: ReadTier.LocalFirst
		})

		return row ? captureDocumentRecord(row, libraryId) : null
	}
	const document = async (id: string) => {
		const row = await db.one(articlesQuery.where({ id: uuid(id), libraryId }), {
			tier: ReadTier.LocalFirst
		})

		return row ? articleSchema.parse(row) : null
	}
	const intent = async (id: string) => {
		const row = await db.one(app.storageOperations.where({ id: uuid(id), libraryId }), {
			tier: ReadTier.LocalFirst
		})

		return row !== null
	}
	const lifecycle = transactionLifecycle(db, isCurrent)
	const readArticle = async (resource: TransactionResource, draft: ArticleDraft) => {
		const article = await resource.tx.one(
			documentsQuery.where({ id: draft.article.id, libraryId }),
			{
				tier: ReadTier.LocalFirst
			}
		)
		return { draft, article: article ? captureDocumentRecord(article, libraryId) : null }
	}
	const ensure = createDomainTransaction<ArticleDraft>(
		(spawn, input) =>
			spawn(
				createArticleEnsureDomain({
					read: readArticle,
					insertArticle: (resource, { draft }) => {
						const id = draft.article.id
						const row = documentValues(draft.article)
						resource.tx.insert(app.libraryDocuments, row, { id })
						resource.tx.insert(
							app.documentCaptures,
							{ libraryId, documentId: id, operationId: null, failure: null },
							{ id }
						)
					},
					receipt: transactionReceipt
				}),
				{ input }
			),
		lifecycle
	)
	const attach = createDomainTransaction<ArticleDraft>(
		(spawn, input) =>
			spawn(
				createArticleAttachmentDomain({
					read: async (resource, draft) => {
						const facts = await readArticle(resource, draft)
						const document = await resource.tx.one(
							app.articles.where({ id: draft.target, libraryId }),
							{ tier: ReadTier.LocalFirst }
						)
						return { ...facts, available: document !== null }
					},
					attachContent: (resource, { draft }) => {
						resource.tx.update(app.libraryDocuments, draft.article.id, {
							attachmentId: draft.target
						})
					},
					createArticle: (resource, { draft }) => {
						const id = draft.article.id
						const row = documentValues(draft.article)
						resource.tx.insert(app.libraryDocuments, { ...row, attachmentId: draft.target }, { id })
						resource.tx.insert(
							app.documentCaptures,
							{ libraryId, documentId: id, operationId: null, failure: null },
							{ id }
						)
					},
					receipt: transactionReceipt
				}),
				{ input }
			),
		lifecycle
	)
	const failure = createDomainTransaction<ArticleFailure>(
		(spawn, input) =>
			spawn(
				createArticleFailureDomain({
					read: async (resource, draft) => {
						const article = await resource.tx.one(
							documentsQuery.where({ id: uuid(draft.id), libraryId }),
							{ tier: ReadTier.LocalFirst }
						)
						return { draft, article: article ? captureDocumentRecord(article, libraryId) : null }
					},
					recordFailure: (resource, { draft }) => {
						if (draft.code !== null && draft.code.length > 100)
							throw new Error('Invalid article failure')
						resource.tx.update(app.documentCaptures, draft.id, { failure: draft.code })
					},
					receipt: transactionReceipt
				}),
				{ input }
			),
		lifecycle
	)

	const organization = createOrganizationRecords(db, libraryId, isCurrent)
	const collection = createArticleCollectionMachine({
		organization: organization.subscribe,
		tags: organization.subscribeTags,
		isCurrent,
		articles: (next, error) =>
			db.subscribe(
				documentsQuery.where({ libraryId }),
				{
					onUpdate: (rows) => next(rows.map((row) => captureDocumentRecord(row, libraryId))),
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
	})

	return {
		libraryId,
		organization,
		read,
		document,
		intent,
		failure,
		saveMachine: createSaveArticleMachine({
			isCurrent,
			prepare: (request) => prepareArticle(libraryId, request),
			read,
			document,
			intent,
			ensure: (spawn, input) => spawn(ensure, { input }),
			attach: (spawn, input) => spawn(attach, { input }),
			content
		}),
		subscribePending: (next: (rows: CaptureDocument[]) => void, error: () => void) =>
			db.subscribe(
				documentsQuery.where({ libraryId, attachmentId: null }),
				{
					onUpdate: (rows) => {
						next(rows.map((row) => captureDocumentRecord(row, libraryId)))
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			),
		subscribe: (next: (rows: LibraryArticle[]) => void, error: () => void) => {
			const actor = createActor(
				collection,

				{ input: { next, error } }
			).start()
			return () => {
				actor.send({ type: 'STOP' })
				actor.stop()
			}
		}
	}
}
