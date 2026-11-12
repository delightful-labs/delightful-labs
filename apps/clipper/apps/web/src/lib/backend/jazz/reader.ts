import { z } from 'zod'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import { createReaderDomain } from '../../machines/storage/reader-domain.js'
import { causalHeads } from '../../capture/causal.js'
import {
	readerChangeSchema,
	readerHistorySchema,
	sameReaderField,
	readerDocumentStateSchema,
	encodeReaderValue
} from '../../reader/schema.js'
import type { ReaderChange, ReaderOperation } from '../../reader/schema.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import { app } from './schema.js'
import type { ReaderCapability, ReaderStageSpawner } from '../../contracts/reader.js'
export function createReaderRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	const stage = (observed: ReaderOperation[]) =>
		createDomainTransaction<ReaderChange>(
			(spawn, input) =>
				spawn(
					createReaderDomain({
						read: async (resource, input, operationId) => {
							const draft = readerChangeSchema.parse(input)
							const [library, document] = await Promise.allSettled([
								resource.tx.one(app.libraries.where({ id: libraryId }), {
									tier: ReadTier.LocalFirst
								}),
								resource.tx.one(
									app.libraryDocuments.where({ id: draft.documentId ?? libraryId, libraryId }),
									{ tier: ReadTier.LocalFirst }
								)
							])
							if (library.status === 'rejected') throw library.reason
							if (document.status === 'rejected') throw document.reason
							return {
								draft,
								operationId,
								library: library.value,
								document: document.value,
								parents: causalHeads(observed.filter((row) => sameReaderField(row, draft))).map(
									(row) => row.id
								)
							}
						},
						updatePosition: (resource, { draft }) => {
							if (draft.field !== 'position') throw new Error('Invalid position mutation')
							const { progress, ...resumePosition } = draft.value
							resource.tx.update(app.libraryDocuments, draft.documentId, {
								readingProgress: progress,
								resumePosition
							})
						},
						insertPreference: (resource, { draft, operationId, parents }) => {
							if (draft.field === 'position') throw new Error('Invalid preference mutation')
							resource.tx.insert(
								app.readerOperations,
								{
									libraryId,
									field: draft.field,
									value: encodeReaderValue(draft),
									parents: JSON.stringify(parents)
								},
								{ id: operationId }
							)
						},
						receipt: transactionReceipt
					}),
					{ input }
				),
			transactionLifecycle(db, isCurrent)
		)

	return {
		stage,
		capability: {
			isCurrent,
			spawnWrite: (
				spawn: ReaderStageSpawner,
				change: ReaderChange,
				operationId: string,
				observed: ReaderOperation[]
			) => {
				return spawn(stage(observed), {
					input: {
						attempt: {
							operationId,
							workspaceId: operationId,
							membershipId: operationId,
							draft: change
						}
					}
				})
			},
			subscribeDocuments: (next, error) =>
				db.subscribe(
					app.libraryDocuments
						.where({ libraryId })
						.select('id', 'readingProgress', 'resumePosition'),
					{
						onUpdate: (rows) => {
							const parsed = z.array(readerDocumentStateSchema).safeParse(rows)
							if (!parsed.success) {
								error()
								return
							}
							next(parsed.data)
						},
						onError: error
					},
					{ tier: ReadTier.LocalFirst }
				),
			subscribe: (next: (rows: ReaderOperation[]) => void, error: () => void) =>
				db.subscribe(
					app.readerOperations.where({ libraryId }),
					{
						onUpdate: (rows) => {
							const parsed = readerHistorySchema.safeParse(rows)
							if (!parsed.success) {
								error()
								return
							}
							next(parsed.data)
						},
						onError: error
					},
					{ tier: ReadTier.LocalFirst }
				)
		} satisfies ReaderCapability
	}
}
