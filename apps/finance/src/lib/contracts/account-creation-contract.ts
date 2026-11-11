import type { Account, OrganizationMember } from '../schema.js'
import type { ScopedFormView } from './form-contract.js'

export type AccountCreationReason =
	'sessionUnavailable' | 'selectWorkspace' | 'loadFailed' | 'loading' | 'readOnly' | 'duplicateName'
export type AccountCreationScope = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
}
export type AccountCreationObservation = AccountCreationScope & {
	accounts: readonly Account[]
	submittedName?: string
	sessionReady: boolean
	membership: OrganizationMember | null | undefined
	loading: boolean
	error: unknown
}
export type AccountCreationView = ScopedFormView<Account, AccountCreationReason>
