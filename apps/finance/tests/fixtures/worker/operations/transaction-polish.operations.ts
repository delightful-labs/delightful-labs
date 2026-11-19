import { fixtureWindow as window } from '../state.js'

export const operation16 = async (href: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Missing polish fixture session')
	const db = snapshot.client.db
	const organizationId = new URL(href).searchParams.get('workspace')
	if (!organizationId) throw new Error('Missing polish workspace')
	const categories = await db.all(app.categories.where({ organizationId, isSystem: true }))
	const tx = db.beginTransaction()
	const account = tx.insert(app.accounts, {
		organizationId,
		name: 'Polish ledger',
		kind: 'bank',
		currency: 'USD'
	})
	const rows: { kind: 'expense' | 'income'; id: string }[] = []
	for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
		const category = categories.find((row) => row.kind === kind)
		if (!category) throw new Error('Missing polish category')
		for (let index = 0; index < 26; index += 1) {
			const row = tx.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind,
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-25',
				description: `Polish ${kind} ${index}`,
				source: 'manual'
			})
			if (index === 0) rows.push({ kind, id: row.id })
		}
	}
	await tx.commit().wait({ tier: 'global' })
	return { organizationId, userId: snapshot.user.accountId, rows }
}

export const operation63 = async (
	mode: 'valid' | 'replacement' | 'broken' | 'missing' | 'nameless'
) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Missing avatar session')
	const db = snapshot.client.db
	const profile = await db.one(app.profiles.where({ userId: snapshot.user.accountId }))
	if (!profile) throw new Error('Missing avatar profile')
	const canvas = new OffscreenCanvas(8, 8)
	const drawing = canvas.getContext('2d')
	if (!drawing) throw new Error('Canvas unavailable')
	drawing.fillStyle = mode === 'replacement' ? '#102030' : '#406080'
	drawing.fillRect(0, 0, 8, 8)
	const image = await canvas.convertToBlob({ type: 'image/png' })
	await db
		.update(app.profiles, profile.id, {
			displayName: mode === 'nameless' ? '' : 'Polish author',
			avatarData:
				mode === 'missing' || mode === 'nameless'
					? null
					: mode === 'broken'
						? new Uint8Array([1, 2, 3])
						: new Uint8Array(await image.arrayBuffer()),
			avatarMimeType: mode === 'missing' || mode === 'nameless' ? null : 'image/png'
		})
		.wait({ tier: 'local' })
}
