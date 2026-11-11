import type { Organization, OrganizationMember } from '../schema.js'
import type { ScopedFormView } from './form-contract.js'

export type WorkspaceRenameReason =
	| 'sessionUnavailable'
	| 'selectWorkspace'
	| 'loadFailed'
	| 'loading'
	| 'workspaceUnavailable'
	| 'readOnly'
export type WorkspaceRenameScope = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
}
export type WorkspaceRenameObservation = WorkspaceRenameScope & {
	sessionReady: boolean
	workspaceLoading: boolean
	membershipLoading: boolean
	workspaceError: boolean
	membershipError: boolean
	workspace: Pick<Organization, 'id' | 'name' | 'defaultCurrency'> | null | undefined
	membership: Pick<OrganizationMember, 'userId' | 'organizationId' | 'role'> | null | undefined
}
export type WorkspaceRenameView = ScopedFormView<void, WorkspaceRenameReason>
