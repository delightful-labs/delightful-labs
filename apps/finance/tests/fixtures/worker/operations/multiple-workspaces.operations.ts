import { fixtureWindow as window } from '../state.js'

export const operation75 = async () => {
	const { db, app } = window.workspaceSettingsTest
	return (await db.all(app.organizations)).length
}

export const operation205 = async (secondId: string) => {
	const { db, app } = window.workspaceSettingsTest
	const organizations = await db.all(app.organizations)
	const first = organizations.find((organization) => organization.id !== secondId)
	if (!first) throw new Error('Missing initial workspace')
	for (const account of [
		{ organizationId: first.id, name: 'Filter checking' },
		{ organizationId: first.id, name: 'Filter cash' },
		{ organizationId: secondId, name: 'Business checking' }
	]) {
		await db
			.insert(app.accounts, { ...account, kind: 'bank', currency: 'USD' })
			.wait({ tier: 'global' })
	}
	return first.id
}

export const operation271 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	const [organizations, profiles, categories, accounts, transactions, memberships] =
		await Promise.all([
			db.all(app.organizations),
			db.all(app.profiles.where({ userId })),
			db.all(app.categories),
			db.all(app.accounts),
			db.all(app.transactions),
			db.all(app.organizationMembers.where({ userId }))
		])
	return {
		organizations,
		profiles: profiles.length,
		categories,
		accounts: accounts.length,
		transactions: transactions.length,
		memberships
	}
}

export const operation316 = async () => {
	const { db, app } = window.workspaceSettingsTest
	const organizations = await db.all(app.organizations.orderBy('id'))
	for (const [index, organization] of organizations.entries()) {
		const account = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: `Account ${index}`,
				kind: 'cash',
				currency: 'USD',
				archivedAt: null
			})
			.wait({ tier: 'global' })
		const categories = await db.all(
			app.categories.where({ organizationId: organization.id, kind: 'expense', isSystem: true })
		)
		const category = categories[0]
		if (!category) throw new Error('Missing category')
		await db
			.insert(app.transactions, {
				organizationId: organization.id,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-21',
				description: `Ledger ${organization.id}`,
				source: 'manual'
			})
			.wait({ tier: 'global' })
	}
	return organizations.map((row) => row.id)
}

export const operation391 = async () => {
	const { db, app } = window.workspaceSettingsTest
	return (await db.all(app.organizations)).length
}

export const operation404 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	const { prepareWorkspaceCreation }: typeof import('#lib/domain/workspace-creation.js') =
		await import('#lib/domain/workspace-creation.js')
	const {
		workspaceCreationJournal
	}: typeof import('#lib/machines/workspaces/workspace-creation-journal.js') =
		await import('#lib/machines/workspaces/workspace-creation-journal.js')
	const { createActor, waitFor }: typeof import('xstate') = await import('xstate')
	const profile = (await db.all(app.profiles.where({ userId })))[0]
	if (!profile) throw new Error('Missing profile')
	const attempt = await prepareWorkspaceCreation({
		organizationId: crypto.randomUUID(),
		profileId: profile.id,
		userId,
		name: 'Recovered workspace'
	})
	const config = db.getConfig()
	const environment = config.env ?? 'finance'
	const key = JSON.stringify([environment, userId])
	const actor = createActor(workspaceCreationJournal, {
		input: { key, mode: 'write', record: { key, attempt } }
	}).start()
	const result = await waitFor(actor, (snapshot) => snapshot.status === 'done')
	actor.stop()
	if (result.output?.outcome !== 'succeeded') throw new Error('Journal write failed')
	return attempt.organizationId
}

export const operation447 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	const {
		workspaceCreationJournal
	}: typeof import('#lib/machines/workspaces/workspace-creation-journal.js') =
		await import('#lib/machines/workspaces/workspace-creation-journal.js')
	const { createActor, waitFor }: typeof import('xstate') = await import('xstate')
	const config = db.getConfig(),
		key = JSON.stringify([config.env ?? 'finance', userId])
	const reader = createActor(workspaceCreationJournal, {
		input: { key, mode: 'read' }
	}).start()
	const read = await waitFor(reader, (snapshot) => snapshot.status === 'done')
	reader.stop()
	if (read.output?.outcome !== 'succeeded' || !read.output.record)
		throw new Error('Original attempt was not retained')
	return {
		ids: (await db.all(app.organizations)).map((row) => row.id),
		journaledId: read.output.record.attempt.organizationId
	}
}

export const operation475 = async () =>
	(await window.workspaceSettingsTest.db.all(window.workspaceSettingsTest.app.organizations)).map(
		(row) => row.id
	)

export const operation490 = async () => {
	const { db, app } = window.workspaceSettingsTest
	const workspace = (await db.all(app.organizations))[0]
	if (!workspace) throw new Error('Missing workspace')
	const account = await db
		.insert(app.accounts, {
			organizationId: workspace.id,
			name: 'Legacy account',
			kind: 'cash',
			currency: 'USD',
			archivedAt: null
		})
		.wait({ tier: 'global' })
	const category = (
		await db.all(
			app.categories.where({ organizationId: workspace.id, kind: 'expense', isSystem: true })
		)
	)[0]
	if (!category) throw new Error('Missing category')
	const transaction = await db
		.insert(app.transactions, {
			organizationId: workspace.id,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 100,
			currency: 'USD',
			bookedOn: '2026-10-21',
			description: 'Legacy detail',
			source: 'manual'
		})
		.wait({ tier: 'global' })
	return { workspaceId: workspace.id, transactionId: transaction.id }
}

export const operation541 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	const profile = (await db.all(app.profiles.where({ userId })))[0]
	if (!profile) throw new Error('Missing profile')
	await db
		.update(app.profiles, profile.id, { displayName: 'Preserved identity' })
		.wait({ tier: 'global' })
	const workspace = await db
		.insert(app.organizations, {
			name: 'Legacy business',
			kind: 'business',
			ownerId: userId,
			defaultCurrency: 'USD'
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.organizationMembers, {
			organizationId: workspace.id,
			userId,
			role: 'owner',
			accountAccessMode: 'all',
			profileId: null
		})
		.wait({ tier: 'global' })
	return workspace.id
}

export const operation572 = async (id: string) => {
	const { db, app, userId } = window.workspaceSettingsTest
	const categories = await db.all(app.categories.where({ organizationId: id }), {
		tier: 'remote'
	})
	const member = (
		await db.all(app.organizationMembers.where({ organizationId: id, userId }), {
			tier: 'remote'
		})
	)[0]
	return {
		count: categories.length,
		system: categories.every((row) => row.isSystem),
		linked: member?.profileId != null
	}
}

export const operation596 = async (id: string) => {
	const { db, app } = window.workspaceSettingsTest
	const optional = (await db.all(app.categories.where({ organizationId: id, isSystem: false })))[0]
	if (!optional) throw new Error('Missing optional starter')
	await db.delete(app.categories, optional.id).wait({ tier: 'global' })
	await db.update(app.organizations, id, { name: 'Edited after creation' }).wait({ tier: 'global' })
}

export const operation615 = async (id: string) => {
	const { db, app, userId } = window.workspaceSettingsTest
	return {
		count: (await db.all(app.categories.where({ organizationId: id }))).length,
		profile: (await db.all(app.profiles.where({ userId })))[0]?.displayName
	}
}

export const operation631 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	const profile = (await db.all(app.profiles.where({ userId })))[0]
	if (!profile) throw new Error('Missing initial profile')
	await db.update(app.profiles, profile.id, { initialWorkspaceId: null }).wait({ tier: 'global' })
	return {
		profileId: profile.id,
		organizations: (await db.all(app.organizations)).map((row) => row.id).sort(),
		memberships: (await db.all(app.organizationMembers.where({ userId })))
			.map((row) => row.id)
			.sort()
	}
}

export const operation651 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	const profiles = await db.all(app.profiles.where({ userId }), { tier: 'remote' })
	return {
		profiles: profiles.map((row) => ({
			id: row.id,
			initialWorkspaceId: row.initialWorkspaceId
		})),
		organizations: (await db.all(app.organizations)).map((row) => row.id).sort(),
		memberships: (await db.all(app.organizationMembers.where({ userId })))
			.map((row) => row.id)
			.sort()
	}
}

export const operation678 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	const member = (await db.all(app.organizationMembers.where({ userId })))[0]
	if (!member) throw new Error('Missing membership')
	await db.delete(app.organizationMembers, member.id).wait({ tier: 'global' })
	return member.organizationId
}

export const operation699 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	return {
		memberships: (await db.all(app.organizationMembers.where({ userId }))).length,
		profiles: (await db.all(app.profiles.where({ userId }))).length
	}
}

export const operation739 = async () => {
	const { db, app } = window.workspaceSettingsTest
	return (await db.all(app.organizations)).length
}

export const operation764 = async (workspaceId: string) => {
	const { db, app } = window.workspaceSettingsTest
	return (await db.all(app.organizations.where({ id: workspaceId }), { tier: 'remote' }))[0]?.name
}

export const operation775 = async (workspaceId: string) => {
	const { db, app } = window.workspaceSettingsTest
	try {
		await db
			.update(app.organizations, workspaceId, { name: 'Unauthorized rename' })
			.wait({ tier: 'global' })
		return false
	} catch {
		return true
	}
}

export const operation788 = async (workspaceId: string) => {
	const { db, app } = window.workspaceSettingsTest
	return (await db.all(app.organizations.where({ id: workspaceId }), { tier: 'remote' }))[0]?.name
}

export const operation843 = async () => {
	const { db, app } = window.workspaceSettingsTest
	const row = (await db.all(app.organizations))[0]
	if (!row) throw new Error('Missing workspace')
	return row.id
}

export const operation877 = async (target: string) => {
	const { db, app } = window.workspaceSettingsTest
	const row = (await db.all(app.organizations)).find((row) => row.id !== target)
	if (!row) throw new Error('Missing initial workspace')
	return row.id
}

export const operation921 = async () => {
	const { db, app } = window.workspaceSettingsTest
	return (await db.all(app.organizations)).filter((row) => row.name === 'Creation across selection')
		.length
}
