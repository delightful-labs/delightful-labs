import { fixtureWindow as window } from '../state.js'

export const operation5 = async (transactionId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const links = await db.all(app.transactionAttachments.where({ transactionId }))
	return Promise.all(
		links.map(async ({ id, fileId }) => {
			const file = await db.one(app.files.where({ id: fileId }), { tier: 'local-first' })
			const parts = await db.all(app.fileParts.where({ fileId }).orderBy('partIndex'))
			return {
				id,
				fileId,
				fileName: file?.fileName,
				mimeType: file?.mimeType,
				parts: parts.length,
				bytes: parts.flatMap((part) => [...(part.data ?? [])])
			}
		})
	)
}

export const operation32 = async (description: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	return (await db.all(app.transactions.where({ description })))[0]?.id
}

export const operation104 = async (fileId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	return db.one(app.files.where({ id: fileId }), { tier: 'local-first' })
}

export const operation118 = async ({
	fileId,
	transactionId
}: {
	fileId: string
	transactionId: string
}) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	await db.insert(app.transactionAttachments, { transactionId, fileId }).wait({ tier: 'global' })
	const file = await db.one(app.files.where({ id: fileId }), { tier: 'remote' })
	const parts = await db.all(app.fileParts.where({ fileId }).orderBy('partIndex'), {
		tier: 'remote'
	})
	return { id: file?.id, bytes: parts.flatMap((part) => [...(part.data ?? [])]) }
}
