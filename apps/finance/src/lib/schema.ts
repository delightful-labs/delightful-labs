import { schema as s } from 'jazz-tools'

import { accountsSchema } from './schema/accounts.js'
import { attachmentsSchema } from './schema/attachments.js'
import { batchesSchema } from './schema/batches.js'
import { categoriesSchema } from './schema/categories.js'
import { checksSchema } from './schema/checks.js'
import { identitySchema } from './schema/identity.js'
import { integrationsSchema } from './schema/integrations.js'
import { bankSyncLogSchema } from './schema/bank-sync-log.js'
import { tagsSchema } from './schema/tags.js'
import { transactionsSchema } from './schema/transactions.js'

const schema = {
	...identitySchema,
	...accountsSchema,
	...categoriesSchema,
	...tagsSchema,
	...transactionsSchema,
	...checksSchema,
	...integrationsSchema,
	...bankSyncLogSchema,
	...attachmentsSchema,
	...batchesSchema
}

export const previousApp = s.defineApp(schema, { migrations: 'none' })

const restoreDefinition = {
	...schema,
	organizations: s.table(
		{ ...identitySchema.organizations.columns, restoreOperationId: s.uuid().optional() },
		{
			...identitySchema.organizations.relations,
			restoreOperation: s.rel('restoreOperations', 'restoreOperationId')
		}
	),
	restoreOperations: s.table(
		{
			workspaceId: s.uuid(),
			sourceFileId: s.uuid(),
			ownerId: s.uuid(),
			status: s.enum('incomplete', 'active'),
			payloadSha256: s.string(),
			graphSha256: s.string(),
			workspaceName: s.string(),
			workspaceKind: s.enum('personal', 'business'),
			workspaceCurrency: s.string()
		},
		{ workspace: s.rel('organizations', 'workspaceId'), sourceFile: s.rel('files', 'sourceFileId') }
	)
}
export const app = s.defineApp(restoreDefinition, { migrations: 'none' })

// Workspace business data excludes operational restore metadata.
export type Organization = s.RowOf<typeof previousApp.organizations>
export type OrganizationMember = s.RowOf<typeof app.organizationMembers>
export type AccountMembership = s.RowOf<typeof app.accountMemberships>
export type Account = s.RowOf<typeof app.accounts>
export type Category = s.RowOf<typeof app.categories>
export type Tag = s.RowOf<typeof app.tags>
export type TransactionRow = s.RowOf<typeof app.transactions>
export type InternalTransfer = s.RowOf<typeof app.internalTransfers>
export type Check = s.RowOf<typeof app.checks>
export type SyncAttempt = s.RowOf<typeof app.simplefinSyncAttempts>
export type SyncAccountResult = s.RowOf<typeof app.simplefinSyncAccountResults>

export const transactionSummaryQuery = app.transactions.select(
	'id',
	'accountId',
	'categoryId',
	'amountMinor',
	'currency',
	'kind'
)

export const transactionDetailQuery = app.transactions
	.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt')
	.include({
		account: true,
		category: true,
		tags: { tag: true },
		check: true,
		attachments: { file: { parts: true } }
	})
export type TransactionDetail = s.RowOf<typeof transactionDetailQuery>
