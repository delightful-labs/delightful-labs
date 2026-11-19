import { fixtureWindow as window } from '../state.js'

export const operation61 = async () => {
	const { db, app, userId } = window.workspaceSettingsTest
	const root = (await db.all(app.organizations, { tier: 'remote' })).find(
		(row) => row.name === 'Exact household'
	)
	if (!root) throw new Error('Restored workspace not active')
	const transactions = await db.all(app.transactions.where({ organizationId: root.id }), {
		tier: 'remote'
	})
	const files = await db.all(
		app.files.where({ transactionId: { in: transactions.map((row) => row.id) } }),
		{ tier: 'remote' }
	)
	const parts = await db.all(
		app.fileParts.where({ fileId: { in: files.map((row) => row.id) } }).orderBy('partIndex'),
		{ tier: 'remote' }
	)
	const operations = await db.all(app.restoreOperations.where({ workspaceId: root.id }), {
		tier: 'remote'
	})
	const operation = operations[0]
	if (!operation || operations.length !== 1) throw new Error('Missing unique restore operation')
	const sourceParts = await db.all(
		app.fileParts.where({ fileId: operation.sourceFileId }).orderBy('partIndex'),
		{ tier: 'remote' }
	)
	return {
		identityId: userId,
		workspaceId: root.id,
		operationId: operation.id,
		status: operation.status,
		applicationId: `${location.origin}/jazz`,
		environment: location.origin,
		rows: {
			organizations: [root],
			transactions,
			files,
			accounts: await db.all(app.accounts.where({ organizationId: root.id }), {
				tier: 'remote'
			}),
			categories: await db.all(app.categories.where({ organizationId: root.id }), {
				tier: 'remote'
			}),
			tags: await db.all(app.tags.where({ organizationId: root.id }), { tier: 'remote' }),
			checks: await db.all(app.checks.where({ organizationId: root.id }), { tier: 'remote' }),
			internalTransfers: await db.all(app.internalTransfers.where({ organizationId: root.id }), {
				tier: 'remote'
			}),
			transactionTags: await db.all(app.transactionTags.where({ organizationId: root.id }), {
				tier: 'remote'
			}),
			transactionBatches: await db.all(app.transactionBatches.where({ organizationId: root.id }), {
				tier: 'remote'
			}),
			batchTemplates: await db.all(app.batchTemplates.where({ organizationId: root.id }), {
				tier: 'remote'
			}),
			transactionAttachments: await db.all(
				app.transactionAttachments.where({ fileId: { in: files.map((row) => row.id) } }),
				{ tier: 'remote' }
			)
		},
		members: await db.all(app.organizationMembers.where({ organizationId: root.id }), {
			tier: 'remote'
		}),
		attachment: parts.flatMap((part) => [...(part.data ?? [])]),
		sourceBytes: sourceParts.flatMap((part) => [...(part.data ?? [])])
	}
}
