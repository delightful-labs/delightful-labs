import type {
	Account,
	AccountMembership,
	Category,
	Tag,
	OrganizationMember,
	TransactionDetail
} from '../schema.js'
import type { TransactionSaveValues } from '../validation/transactions.js'
import type { ScopedFormView } from './form-contract.js'

export type TransactionEntryScope = {
	identityId: OrganizationMember['userId'] | null
	organizationId: TransactionDetail['organizationId'] | null
	binding: object | null
	kind: TransactionDetail['kind']
	transactionId?: TransactionDetail['id'] | null
}
export type TransactionEntryReason =
	| 'sessionUnavailable'
	| 'selectWorkspace'
	| 'loadFailed'
	| 'loading'
	| 'readOnly'
	| 'noAccounts'
	| 'noCategories'
	| 'unavailableReference'
	| 'ambiguousTagName'
	| 'checkRetained'
	| 'saveUnresolved'
	| 'attachmentsFailed'
	| 'linkedTransferRequiresUnlink'
export type TransactionEntryObservation = TransactionEntryScope & {
	sessionReady: boolean
	loading: boolean
	failed: boolean
	membership: OrganizationMember | null | undefined
	grants: readonly Pick<AccountMembership, 'accountId' | 'access'>[]
	accounts: readonly Account[]
	categories: readonly Category[]
	tags: readonly Tag[]
	intent?: TransactionSaveValues
	transaction?: TransactionDetail | null
}
export type TransactionEntryView = ScopedFormView<unknown, TransactionEntryReason>
