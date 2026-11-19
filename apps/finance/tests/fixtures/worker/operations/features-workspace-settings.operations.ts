import { recordFixtureEffect } from '../effects.js'
import { fixtureWindow as window } from '../state.js'

export const operation92 = () => window.workspaceSettingsTest.userId

export const operation93 = async ({
	organizationId,
	subjectId,
	role
}: {
	organizationId: string
	subjectId: string
	role: string
}) => {
	const { app, db } = window.workspaceSettingsTest
	if (role !== 'admin' && role !== 'member' && role !== 'viewer')
		throw new Error('Invalid test role.')
	await db
		.update(app.organizations, organizationId, { name: 'Shared workspace' })
		.wait({ tier: 'global' })
	await db
		.insert(app.organizationMembers, {
			organizationId,
			userId: subjectId,
			role,
			accountAccessMode: 'all'
		})
		.wait({ tier: 'global' })
}

export const operation148 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	try {
		await db
			.update(app.organizations, organizationId, { name: 'Forbidden rename' })
			.wait({ tier: 'global' })
		return 'accepted'
	} catch (error) {
		return error instanceof Error ? error.message : 'unknown-error'
	}
}

export const operation160 = async (organizationId: string) => {
	const { app, db } = window.workspaceSettingsTest
	return (await db.one(app.organizations.where({ id: organizationId }), { tier: 'remote' }))?.name
}

export const operation187 = () => {
	const { db, userId } = window.workspaceSettingsTest
	const begin = db.beginSerializableTransaction.bind(db)
	Object.defineProperty(db, 'beginSerializableTransaction', {
		configurable: true,
		writable: true,
		value: () => {
			const transaction = begin()
			transaction.commit = () => {
				recordFixtureEffect('backup-commit')
				throw new Error('Injected export failure before native commit')
			}
			transaction.rollback = async () => false
			return transaction
		}
	})
	return userId
}

export const operation226 = () => window.workspaceSettingsTest.userId

export const operation240 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	const root = (await db.all(app.organizations.where({ ownerId: userId }), { tier: 'remote' }))[0]
	if (!root) throw new Error('Missing disposable workspace')
	const organizationId = root.id,
		accountId = crypto.randomUUID(),
		categoryId = crypto.randomUUID(),
		transactionId = crypto.randomUUID(),
		fileId = crypto.randomUUID()
	const tx = db.beginTransaction()
	tx.insert(
		app.accounts,
		{ organizationId, name: 'Backup account', currency: 'USD', kind: 'cash' },
		{ id: accountId }
	)
	tx.insert(
		app.categories,
		{ organizationId, name: 'Backup category', kind: 'expense', isSystem: false },
		{ id: categoryId }
	)
	for (let index = 0; index < 521; index++)
		tx.insert(
			app.transactions,
			{
				organizationId,
				accountId,
				categoryId,
				kind: 'expense',
				currency: 'USD',
				amountMinor: index + 1,
				bookedOn: '2026-11-01',
				description: 'Exact transaction ' + index,
				source: 'manual'
			},
			{ id: index === 0 ? transactionId : crypto.randomUUID() }
		)
	await tx.commit().wait({ tier: 'global' })
	const attachment = db.beginTransaction()
	attachment.insert(
		app.files,
		{
			transactionId,
			fileName: 'exact-receipt.bin',
			mimeType: 'application/octet-stream',
			sizeBytes: 8
		},
		{ id: fileId }
	)
	attachment.insert(app.transactionAttachments, { transactionId, fileId })
	attachment.insert(app.fileParts, {
		fileId,
		partIndex: 0,
		sizeBytes: 8,
		data: new Uint8Array([0, 1, 127, 255, 9, 8, 7, 6])
	})
	await attachment.commit().wait({ tier: 'global' })
	const records = await db.all(
		app.transactions
			.where({ organizationId })
			.select('*', '$createdAt', '$updatedAt', '$createdBy', '$updatedBy'),
		{ tier: 'remote' }
	)
	return {
		organizationId,
		transactionId,
		fileId,
		records: JSON.stringify(records.toSorted((a, b) => a.id.localeCompare(b.id)))
	}
}

export const operation352 = async (organizationId: string) => {
	const { db, app } = window.workspaceSettingsTest
	const records = await db.all(
		app.transactions
			.where({ organizationId })
			.select('*', '$createdAt', '$updatedAt', '$createdBy', '$updatedBy'),
		{ tier: 'remote' }
	)
	return JSON.stringify(records.toSorted((a, b) => a.id.localeCompare(b.id)))
}

export const operation384 = async () =>
	(
		await window.workspaceSettingsTest.db.all(window.workspaceSettingsTest.app.organizations, {
			tier: 'remote'
		})
	).map((row) => row.id)

export const operation415 = async () =>
	(
		await window.workspaceSettingsTest.db.all(window.workspaceSettingsTest.app.organizations, {
			tier: 'remote'
		})
	).map((row) => row.id)

export const operation435 = async () =>
	(
		await window.workspaceSettingsTest.db.all(window.workspaceSettingsTest.app.organizations, {
			tier: 'remote'
		})
	).map((row) => row.id)

export const operation478 = async (beforeIds: string[]) => {
	const { db, app } = window.workspaceSettingsTest
	const roots = await db.all(app.organizations, { tier: 'remote' }),
		root = roots.find((row) => !beforeIds.includes(row.id))
	if (!root) throw new Error('Missing restored workspace')
	const transactions = await db.all(app.transactions.where({ organizationId: root.id }), {
			tier: 'remote'
		}),
		members = await db.all(app.organizationMembers.where({ organizationId: root.id }), {
			tier: 'remote'
		}),
		operations = await db.all(app.restoreOperations.where({ workspaceId: root.id }), {
			tier: 'remote'
		})
	const first = transactions.find((row) => row.description === 'Exact transaction 0')
	if (!first) throw new Error('Missing restored attachment transaction')
	const files = await db.all(app.files.where({ transactionId: first.id }), {
		tier: 'remote'
	})
	const parts = await db.all(
		app.fileParts.where({ fileId: { in: files.map((row) => row.id) } }).orderBy('partIndex'),
		{ tier: 'remote' }
	)
	return {
		id: root.id,
		roots: roots.length,
		transactions: transactions.length,
		descriptions: transactions.map((row) => row.description).sort(),
		facts: transactions
			.map((row) => ({
				description: row.description,
				amountMinor: row.amountMinor,
				currency: row.currency,
				bookedOn: row.bookedOn,
				kind: row.kind,
				source: row.source
			}))
			.toSorted((a, b) => a.amountMinor - b.amountMinor),
		attachment: parts.flatMap((part) => [...(part.data ?? [])]),
		members: members.map((row) => ({ role: row.role, userId: row.userId })),
		operationCount: operations.length
	}
}

export const operation545 = async (source: {
	organizationId: string
	transactionId: `${string}-${string}-${string}-${string}-${string}`
	fileId: `${string}-${string}-${string}-${string}-${string}`
	records: string
}) =>
	JSON.stringify(
		(
			await window.workspaceSettingsTest.db.all(
				window.workspaceSettingsTest.app.transactions
					.where({ organizationId: source.organizationId })
					.select('*', '$createdAt', '$updatedAt', '$createdBy', '$updatedBy'),
				{ tier: 'remote' }
			)
		).toSorted((a, b) => a.id.localeCompare(b.id))
	)

export const operation573 = async () =>
	(
		await window.workspaceSettingsTest.db.all(window.workspaceSettingsTest.app.organizations, {
			tier: 'remote'
		})
	).length
