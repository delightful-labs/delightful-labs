import type {
	Account,
	AccountMembership,
	Category,
	Tag,
	OrganizationMember,
	TransactionDetail
} from '../queries.js'
import type { TransactionSaveValues } from '../validation/transactions.js'
import type { ScopedFormView } from './form-contract.js'

export type TransactionEntryScope = {
	identityId: OrganizationMember['userId'] | null
	organizationId: TransactionDetail['organizationId'] | null
	binding: object | null
	kind: TransactionDetail['kind']
	transactionId?: TransactionDetail['id'] | null
}
export const TRANSACTION_ENTRY_REASON = Object.freeze({
	sessionUnavailable: 'sessionUnavailable',
	selectWorkspace: 'selectWorkspace',
	loadFailed: 'loadFailed',
	loading: 'loading',
	readOnly: 'readOnly',
	noAccounts: 'noAccounts',
	noCategories: 'noCategories',
	unavailableReference: 'unavailableReference',
	ambiguousTagName: 'ambiguousTagName',
	checkRetained: 'checkRetained',
	saveUnresolved: 'saveUnresolved',
	attachmentsFailed: 'attachmentsFailed',
	linkedTransferRequiresUnlink: 'linkedTransferRequiresUnlink'
})
export type TransactionEntryReason =
	(typeof TRANSACTION_ENTRY_REASON)[keyof typeof TRANSACTION_ENTRY_REASON]
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
	transaction?:
		(Omit<TransactionDetail, 'attachments'> & { attachments: readonly { id: string }[] }) | null
}
export type TransactionEntryView = ScopedFormView<unknown, TransactionEntryReason>
