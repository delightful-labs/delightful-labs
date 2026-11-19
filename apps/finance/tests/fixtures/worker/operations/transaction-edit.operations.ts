import { fixtureWindow as window } from '../state.js'

export const operation353 = async (id: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	const date = new Date()
	const bookedOn = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
	await db
		.update(app.transactions, id, { bookedOn, description: 'Tagged cleanup row' })
		.wait({ tier: 'local' })
}

export const operation374 = async (id: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	await db.update(app.tags, id, { name: 'Renamed historical' }).wait({ tier: 'local' })
}

export const operation458 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Missing database')
	return (await db.all(app.categories))
		.filter((row) =>
			[
				'First inline category',
				'Second inline category',
				'Category only change',
				'Cancelled category'
			].includes(row.name)
		)
		.map(({ id, name, kind }) => ({ id, name, kind }))
}
