import { fixtureWindow as window } from '../state.js'

export const operation11 = async (organizationId: string) => {
	const { app, db, userId } = window.workspaceSettingsTest
	const second = await db
		.insert(app.organizations, {
			name: 'Profile second workspace',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: userId
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.organizationMembers, {
			organizationId: second.id,
			userId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
	const account = await db
		.insert(app.accounts, {
			organizationId,
			name: 'Profile checking',
			kind: 'bank',
			currency: 'USD'
		})
		.wait({ tier: 'global' })
	const category = await db.one(
		app.categories.where({ organizationId, kind: 'expense', isSystem: true })
	)
	if (!category) throw new Error('No Category')
	const transaction = await db
		.insert(app.transactions, {
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind: 'expense',
			amountMinor: 100,
			currency: 'USD',
			bookedOn: '2026-10-14',
			source: 'manual'
		})
		.wait({ tier: 'global' })
	return { secondId: second.id, transactionId: transaction.id, userId }
}

export const operation68 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	return (await db.one(app.profiles.where({ userId }), { tier: 'local-first' }))?.displayName
}

export const operation79 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	return (await db.one(app.profiles.where({ userId }), { tier: 'remote' }))?.displayName
}

export const operation114 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
	if (!profile) throw new Error('Missing profile')
	await db
		.update(app.profiles, profile.id, { displayName: 'Protected profile owner' })
		.wait({ tier: 'global' })
	return { profileId: profile.id, userId }
}

export const operation127 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
	if (!profile) throw new Error('Missing member profile')
	return { userId, profileId: profile.id }
}

export const operation128 = async ({
	organizationId,
	subjectId,
	profileId
}: {
	organizationId: string
	subjectId: string
	profileId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	await db
		.insert(app.organizationMembers, {
			organizationId,
			userId: subjectId,
			profileId,
			role: 'member',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
}

export const operation155 = async (owner: { profileId: string; userId: string }) => {
	const { app, db, userId } = window.workspaceSettingsTest
	const own = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
	if (!own) throw new Error('Missing member profile')
	const visibleOwner = await db.one(app.profiles.where({ id: owner.profileId }), {
		tier: 'remote'
	})
	let edit = 'accepted'
	let transfer = 'accepted'
	try {
		await db
			.upsert(app.profiles, owner.profileId, {
				userId: owner.userId,
				displayName: 'Hijacked name',
				avatarData: new Uint8Array([1]),
				avatarMimeType: 'image/png'
			})
			.wait({ tier: 'global' })
	} catch (error) {
		edit = error instanceof Error ? error.message : 'unknown-error'
	}
	try {
		await db.update(app.profiles, own.id, { userId: owner.userId }).wait({ tier: 'global' })
	} catch (error) {
		transfer = error instanceof Error ? error.message : 'unknown-error'
	}
	const retained = await db.one(app.profiles.where({ id: own.id }), { tier: 'remote' })
	return {
		edit,
		transfer,
		ownerVisible: Boolean(visibleOwner),
		ownName: retained?.displayName,
		ownUserId: retained?.userId
	}
}

export const operation197 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	const profile = await db.one(app.profiles.where({ id }), { tier: 'remote' })
	return {
		name: profile?.displayName,
		hasAvatar: Boolean(profile?.avatarData),
		mimeType: profile?.avatarMimeType ?? null
	}
}

export const operation223 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
	if (!profile) throw new Error('Missing owner profile')
	await db
		.update(app.profiles, profile.id, {
			displayName: 'Shared display profile',
			avatarData: new Uint8Array([1, 2, 3]),
			avatarMimeType: 'image/png'
		})
		.wait({ tier: 'global' })
	const privateWorkspace = await db
		.insert(app.organizations, {
			name: 'Private workspace',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: userId
		})
		.wait({ tier: 'global' })
	await db
		.insert(app.organizationMembers, {
			organizationId: privateWorkspace.id,
			userId,
			profileId: profile.id,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
	return { id: profile.id, userId }
}

export const operation257 = async () => {
	const { app, db, userId } = window.workspaceSettingsTest
	const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
	if (!profile) throw new Error('Missing member profile')
	await db
		.update(app.profiles, profile.id, { displayName: 'Shared member' })
		.wait({ tier: 'global' })
	return { id: profile.id, userId }
}

export const operation267 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	const profile = await db.one(app.profiles.where({ id }), { tier: 'remote' })
	return profile
		? {
				name: profile.displayName,
				bytes: Array.from(profile.avatarData ?? []),
				mime: profile.avatarMimeType
			}
		: null
}

export const operation279 = async ({
	organizationId,
	subjectProfile,
	role
}: {
	organizationId: string
	subjectProfile: { id: string; userId: string }
	role: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	if (role !== 'admin' && role !== 'member' && role !== 'viewer') throw new Error('Invalid role')
	const membership = await db
		.insert(app.organizationMembers, {
			organizationId,
			userId: subjectProfile.userId,
			role,
			accountAccessMode: 'selected'
		})
		.wait({ tier: 'global' })
	return membership.id
}

export const operation301 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	return Boolean(await db.one(app.profiles.where({ id }), { tier: 'remote' }))
}

export const operation306 = async ({
	membershipId,
	profileId
}: {
	membershipId: string
	profileId: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	await db.update(app.organizationMembers, membershipId, { profileId }).wait({ tier: 'global' })
}

export const operation317 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	return (await db.one(app.profiles.where({ id }), { tier: 'remote' }))?.displayName ?? null
}

export const operation326 = async (ownerId: string) => {
	const { app, db } = window.workspaceSettingsTest
	return (await db.all(app.organizations.where({ ownerId }), { tier: 'remote' })).map(
		(organization) => organization.id
	)
}

export const operation333 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	await db.delete(app.organizationMembers, id).wait({ tier: 'global' })
}

export const operation340 = async (id: string) => {
	const { app, db } = window.workspaceSettingsTest
	return (await db.one(app.profiles.where({ id }), { tier: 'remote' }))?.displayName ?? null
}
