import type { Account, OrganizationMember } from '../schema.js'
import type { ScopedFormView } from './form-contract.js'

export const ACCOUNT_CREATION_REASON = Object.freeze({
	sessionUnavailable: 'sessionUnavailable',
	selectWorkspace: 'selectWorkspace',
	loadFailed: 'loadFailed',
	loading: 'loading',
	readOnly: 'readOnly',
	duplicateName: 'duplicateName'
})
export type AccountCreationReason =
	(typeof ACCOUNT_CREATION_REASON)[keyof typeof ACCOUNT_CREATION_REASON]
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
