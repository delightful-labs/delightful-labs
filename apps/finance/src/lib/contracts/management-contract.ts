import type { Category, Tag, OrganizationMember } from '../schema.js'
import type { ScopedFormView } from './form-contract.js'
export type ManagementScope = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
}
export const MANAGEMENT_REASON = Object.freeze({
	sessionUnavailable: 'sessionUnavailable',
	selectWorkspace: 'selectWorkspace',
	loading: 'loading',
	loadFailed: 'loadFailed',
	readOnly: 'readOnly',
	unavailableReference: 'unavailableReference',
	protectedRecord: 'protectedRecord',
	duplicateName: 'duplicateName'
})
export type ManagementReason = (typeof MANAGEMENT_REASON)[keyof typeof MANAGEMENT_REASON]

export type ManagementObservation = ManagementScope & {
	sessionReady: boolean
	membership: OrganizationMember | null | undefined
	loading: boolean
	failed: boolean
	categories: readonly Category[]
	tags: readonly Tag[]
	intent?:
		| { kind: 'archiveCategory'; id: string; organizationId: string }
		| { kind: 'archiveTag'; id: string; organizationId: string }
		| { kind: 'createCategory'; name: string; categoryKind: Category['kind'] }
		| { kind: 'createTag'; name: string; tagKind: Category['kind']; categoryId: string | null }
}
export type ManagementView<Result> = ScopedFormView<Result, ManagementReason>
