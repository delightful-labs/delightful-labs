import { newDocumentValues } from './document-values.js'
import { captureDocumentRecord, documentRecord } from './document-record.js'
import { createImageRecords } from './images.js'
import { createNoteRecords } from './notes.js'
import {
	createContentIntentDomain,
	createContentPublicationDomain
} from '../../machines/storage/content-domains.js'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import type { ContentFacts } from '../../capture/content-policy.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import type { ReadCapabilities } from '../../contracts/storage.js'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import type { PreparedSave } from '../../contracts/storage.js'
import { createSaveRecordMachine } from '../../machines/storage/save.js'
import { prepareSave } from '../../storage/prepare.js'
import { app } from './schema.js'
import { documentsQuery } from './queries.js'
import { insertPreparedContent } from './content.js'
import { createReaderRecords } from './reader.js'
import { createFakeDataRecords } from './fake-data.js'
import { createArticleRecords } from './articles.js'
import type { SearchDocument } from '../../search/schema.js'
import type { LibraryArticle } from '../../contracts/articles.js'

/** Reads stay bound to this DB/library; owning actors gate admission and late-result consumption.
 * Native write admission and commit scope protection live in transactionLifecycle. */
export function createLibraryRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'beginSerializableTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean,
	observeConnection?: ReadCapabilities['observeConnection']
) {
	const readLocal = async (
		resource: TransactionResource,
		draft: PreparedSave,
		operationId: string
	): Promise<ContentFacts> => {
		const intent = await resource.tx.one(
			app.storageOperations.where({ id: operationId, libraryId }),
			{ tier: ReadTier.LocalFirst }
		)
		const article = await resource.tx.one(
			documentsQuery.where({ id: draft.documentId, libraryId }),
			{
				tier: ReadTier.LocalFirst
			}
		)
		return {
			draft,
			operationId,
			intent,
			article: article ? captureDocumentRecord(article, libraryId) : null
		}
	}
	const lifecycle = transactionLifecycle(db, isCurrent)
	const intent = createDomainTransaction<PreparedSave>(
		(spawn, input) =>
			spawn(
				createContentIntentDomain({
					read: readLocal,
					insertIntent: (resource, { draft }) => {
						const { id, ...intent } = draft.intent
						resource.tx.insert(app.storageOperations, intent, { id })
					},
					bindArticle: (resource, { draft }) => {
						resource.tx.update(app.documentCaptures, draft.documentId, {
							operationId: draft.intent.id,
							failure: null
						})
					},
					createArticle: (resource, { draft }) => {
						resource.tx.insert(
							app.libraryDocuments,
							newDocumentValues(draft.documentId, libraryId, draft.source?.submittedUrl ?? null),
							{ id: draft.documentId }
						)
						resource.tx.insert(
							app.documentCaptures,
							{
								libraryId,
								documentId: draft.documentId,
								operationId: draft.intent.id,
								failure: null
							},
							{ id: draft.documentId }
						)
					},
					receipt: transactionReceipt
				}),
				{ input }
			),
		lifecycle
	)
	const publish = createDomainTransaction<PreparedSave>(
		(spawn, input) =>
			spawn(
				createContentPublicationDomain({
					read: readLocal,
					publishContent: (resource, { draft }) => insertPreparedContent(resource.tx, draft),
					attachContent: (resource, { draft }) => {
						resource.tx.update(app.libraryDocuments, draft.documentId, {
							attachmentId: draft.attachment.id
						})
						resource.tx.update(app.documentCaptures, draft.documentId, { failure: null })
					},
					receipt: transactionReceipt
				}),
				{ input }
			),
		lifecycle
	)

	const records = {
		binding: Object.freeze({}),
		saveMachine: createSaveRecordMachine({
			isCurrent,
			prepare: (request) => prepareSave(libraryId, request),
			intent: (spawn, input) => spawn(intent, { input }),
			publish: (spawn, input) => spawn(publish, { input })
		}),
		readCapabilities: {
			isCurrent,
			observeConnection,
			document: async (id, signal) => {
				signal.throwIfAborted()
				const row = await db.one(documentsQuery.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst,
					firstLoadRemoteWaitMs: 5000
				})
				signal.throwIfAborted()
				return row ? documentRecord(row, libraryId) : null
			}
		} satisfies ReadCapabilities
	}
	return {
		...records,
		reader: createReaderRecords(db, libraryId, isCurrent),
		notes: createNoteRecords(db, libraryId, isCurrent),
		images: createImageRecords(db, libraryId, isCurrent),
		fakeData: createFakeDataRecords(db, libraryId, isCurrent),
		searchDocuments: async (
			rows: LibraryArticle[],
			signal: AbortSignal
		): Promise<SearchDocument[]> => {
			signal.throwIfAborted()
			const documents = await db.all(documentsQuery.where({ libraryId }), {
				tier: ReadTier.LocalFirst
			})
			signal.throwIfAborted()
			const byId = new Map(documents.map((row) => [row.id, documentRecord(row, libraryId)]))
			return rows.map((row) => ({
				id: row.id,
				title: row.title,
				url: row.url ?? '',
				text: byId.get(row.id)?.attachment?.text ?? '',
				tags: (row.tags ?? []).map((tag) => tag.name).join(' '),
				createdAt: row.createdAt
			}))
		},
		observeSearch: (dirty: () => void, error: () => void) =>
			db.subscribe(
				app.articles.where({ libraryId }),
				{ onUpdate: dirty, onError: error },
				{ tier: ReadTier.LocalFirst }
			),
		articles: createArticleRecords(db, libraryId, isCurrent, (spawn, input) =>
			spawn(records.saveMachine, { input })
		),
		isCurrent,
		hasDocument: async (id: string) => {
			const row = await db.one(app.articles.where({ id, libraryId }), {
				tier: ReadTier.LocalFirst,
				firstLoadRemoteWaitMs: 5_000
			})

			return row !== null
		},
		hasIntent: async (id: string) => {
			const row = await db.one(app.storageOperations.where({ id, libraryId }), {
				tier: ReadTier.LocalFirst,
				firstLoadRemoteWaitMs: 5_000
			})

			return row !== null
		}
	}
}

export type LibraryRecords = ReturnType<typeof createLibraryRecords>
