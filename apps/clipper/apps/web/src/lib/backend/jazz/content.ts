import type { Transaction } from 'jazz-tools'
import type { PreparedSave } from '../../contracts/storage.js'
import { app } from './schema.js'
/** One selected atomic publication batch; Article owns its content and capture evidence. */
export function insertPreparedContent(
	tx: Pick<Transaction, 'insert' | 'upsert'>,
	draft: PreparedSave
) {
	const { id, site, ...article } = draft.attachment
	if (site)
		tx.upsert(app.sites, site.id, {
			libraryId: draft.intent.libraryId,
			origin: site.origin,
			...(site.name === null ? {} : { name: site.name })
		})
	tx.insert(
		app.articles,
		{
			...article,
			libraryId: draft.intent.libraryId,
			operationId: draft.intent.id,
			siteId: site?.id ?? null
		},
		{ id }
	)
	for (const { id, ...image } of draft.images ?? []) tx.insert(app.articleImages, image, { id })
}
