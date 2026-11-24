import { fixtureWindow as window } from '../state.js'

export const operation61 = async (
	workspaceId?: string,
	tier: 'remote' | 'local-first' = 'remote'
) => {
	const { db, app, userId } = window.workspaceSettingsTest
	const root = (await db.all(app.organizations, { tier })).find((row) =>
		workspaceId ? row.id === workspaceId : row.name === 'Exact household'
	)
	if (!root) throw new Error('Restored workspace not active')
	const transactions = await db.all(app.transactions.where({ organizationId: root.id }), {
		tier
	})
	const files = await db.all(
		app.files.where({ transactionId: { in: transactions.map((row) => row.id) } }),
		{ tier }
	)
	const parts = await db.all(
		app.fileParts.where({ fileId: { in: files.map((row) => row.id) } }).orderBy('partIndex'),
		{ tier }
	)
	const operations = await db.all(app.restoreOperations.where({ workspaceId: root.id }), {
		tier
	})
	const operation = operations[0]
	if (!operation || operations.length !== 1) throw new Error('Missing unique restore operation')
	const sourceParts = await db.all(
		app.fileParts.where({ fileId: operation.sourceFileId }).orderBy('partIndex'),
		{ tier }
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
				tier
			}),
			categories: await db.all(app.categories.where({ organizationId: root.id }), {
				tier
			}),
			tags: await db.all(app.tags.where({ organizationId: root.id }), { tier }),
			checks: await db.all(app.checks.where({ organizationId: root.id }), { tier }),
			internalTransfers: await db.all(app.internalTransfers.where({ organizationId: root.id }), {
				tier
			}),
			transactionTags: await db.all(app.transactionTags.where({ organizationId: root.id }), {
				tier
			}),
			transactionBatches: await db.all(app.transactionBatches.where({ organizationId: root.id }), {
				tier
			}),
			batchTemplates: await db.all(app.batchTemplates.where({ organizationId: root.id }), {
				tier
			}),
			transactionAttachments: await db.all(
				app.transactionAttachments.where({ fileId: { in: files.map((row) => row.id) } }),
				{ tier }
			)
		},
		members: await db.all(app.organizationMembers.where({ organizationId: root.id }), {
			tier
		}),
		attachment: parts.flatMap((part) => [...(part.data ?? [])]),
		sourceBytes: sourceParts.flatMap((part) => [...(part.data ?? [])])
	}
}
