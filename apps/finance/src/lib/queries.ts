import type { RowOf } from 'jazz-tools'
import { app } from './jazz.generated.js'
export { app } from './jazz.generated.js'

// Workspace business data excludes operational restore metadata.
export type Organization = Omit<RowOf<typeof app.organizations>, 'restoreOperationId'>
export type OrganizationMember = RowOf<typeof app.organizationMembers>
export type AccountMembership = RowOf<typeof app.accountMemberships>
export type Account = RowOf<typeof app.accounts>
export type Category = RowOf<typeof app.categories>
export type Tag = RowOf<typeof app.tags>
export type TransactionRow = RowOf<typeof app.transactions>
export type InternalTransfer = RowOf<typeof app.internalTransfers>
export type Check = RowOf<typeof app.checks>
export type SyncAttempt = RowOf<typeof app.simplefinSyncAttempts>
export type SyncAccountResult = RowOf<typeof app.simplefinSyncAccountResults>

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
export type TransactionDetail = RowOf<typeof transactionDetailQuery>
