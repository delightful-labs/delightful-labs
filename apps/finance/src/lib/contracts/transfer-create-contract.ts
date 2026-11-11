import type { Account, AccountMembership, Category, OrganizationMember } from '../schema.js'
import type { ScopedFormView } from './form-contract.js'

export type InternalTransferEntryScope = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
}

export type InternalTransferEntryObservation = InternalTransferEntryScope & {
	sessionReady: boolean
	loading: boolean
	failed: boolean
	membership: OrganizationMember | null | undefined
	grants: readonly Pick<AccountMembership, 'accountId' | 'access'>[]
	accounts: readonly Account[]
	categories: readonly Category[]
}

export type InternalTransferEntryReason =
	| 'sessionUnavailable'
	| 'selectWorkspace'
	| 'loadFailed'
	| 'loading'
	| 'readOnly'
	| 'noAccounts'
	| 'insufficientAccounts'
	| 'noCategories'
	| 'permissionChanged'
	| 'incompatible'
	| 'unavailable'

export type InternalTransferEntryValues = {
	expenseAccountId: string
	incomeAccountId: string
	expenseAmountMinor: number
	incomeAmountMinor: number
	expenseCurrency: string
	incomeCurrency: string
	bookedOn: string
}

export type InternalTransferCreated = {
	transferId: string
	expenseTransactionId: string
	incomeTransactionId: string
}

export type InternalTransferEntryView = ScopedFormView<
	InternalTransferCreated,
	InternalTransferEntryReason
>
