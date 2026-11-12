import { documentValues } from './document-values.js'
import { retainDetachedTransaction } from './transaction.js'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createFakeDataMachine, canSeedLibrary } from '../../samples/machine.js'
import type { SeedRows } from '../../samples/machine.js'
import type { FakeDataPlan } from '../../samples/plan.js'
import { insertPreparedContent } from './content.js'
import { app } from './schema.js'
export type FakeDataDb = Pick<Db, 'one' | 'all' | 'beginSerializableTransaction'>
type Resource = { tx: ReturnType<FakeDataDb['beginSerializableTransaction']> }
type Write = ReturnType<Resource['tx']['commit']>
export function createFakeDataRecords(db: FakeDataDb, libraryId: string, isCurrent: () => boolean) {
	async function presence(reader: Pick<Db, 'one' | 'all'>, tier?: ReadTier): Promise<SeedRows> {
		const options = tier === undefined ? undefined : { tier }
		const [articles, documents, intents, root] = await Promise.all([
			reader.all(app.libraryDocuments.where({ libraryId }).limit(1), options),
			reader.all(app.articles.where({ libraryId }).limit(1), options),
			reader.all(app.storageOperations.where({ libraryId }).limit(1), options),
			reader.one(app.libraries.where({ id: libraryId }), options)
		])
		return {
			hasData: articles.length > 0 || documents.length > 0 || intents.length > 0,
			owned: root?.ownerId === libraryId && root.bootstrapVersion === '1'
		}
	}
	function admit() {
		if (!isCurrent()) throw new Error('Library scope expired')
	}
	const stage = createWorkspaceCreationTransaction<FakeDataPlan, Resource, SeedRows, number, Write>(
		{
			retainDetached: retainDetachedTransaction<Resource, Write>,
			open: () => {
				admit()
				return { tx: db.beginSerializableTransaction() }
			},
			readLocal: (resource) => presence(resource.tx),
			assess: (rows) =>
				canSeedLibrary(rows)
					? { outcome: 'eligible' }
					: { outcome: 'blocked', reason: 'Library is populated or unavailable' },
			stage: ({ tx }, { draft }) => {
				for (const item of draft) {
					const { id: operationId, ...intent } = item.content.intent
					tx.insert(app.storageOperations, intent, { id: operationId })
					insertPreparedContent(tx, item.content)
					const id = item.article.id
					const article = documentValues(item.article)
					tx.insert(app.libraryDocuments, article, { id })
					tx.insert(
						app.documentCaptures,
						{ libraryId, documentId: id, operationId: item.content.intent.id, failure: null },
						{ id }
					)
					for (const { id: propertyId, ...property } of item.properties)
						tx.insert(app.organizationOperations, property, { id: propertyId })
					const { id: tagId, ...tag } = item.tag
					tx.insert(app.tagOperations, tag, { id: tagId })
				}
				return draft.length
			},
			commit: ({ tx }) => {
				admit()
				return tx.commit()
			},
			persistLocal: (write) => write.wait(),
			rollback: ({ tx }) => tx.rollback()
		}
	)
	return (enabled: boolean) =>
		createFakeDataMachine({
			enabled,
			isCurrent,
			libraryId,
			stage: (spawn, input) => spawn(stage, { input }),
			local: () => presence(db, ReadTier.LocalFirst),
			authority: () => presence(db, ReadTier.Remote)
		})
}
