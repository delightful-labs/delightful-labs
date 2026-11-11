import type { OrganizationMember } from '../schema.js'
import type {
	IntegrityIssue,
	IntegrityScope
} from '../machines/workspaces/workspace-integrity-assessment.js'
import type { IntegrityResult } from '../machines/workspaces/workspace-integrity-transaction.js'
import type { ActorRef, Snapshot } from 'xstate'

export type IntegrityBinding = IntegrityScope & {
	membershipId: string
	role: OrganizationMember['role']
	accountAccessMode: OrganizationMember['accountAccessMode']
}
export type IntegrityRequest = {
	generation: number
	binding: IntegrityBinding | undefined
}
type Settlement = IntegrityResult['settlement']
export type IntegrityStatus =
	| { kind: 'waiting' | 'checking' }
	| { kind: 'complete' | 'unavailable' | 'conflict' | 'failed'; settlement: Settlement }
	| {
			kind: 'partial'
			issues: readonly IntegrityIssue[]
			settlement: Settlement
			access: 'usable'
	  }
	| { kind: 'unresolved'; settlement: 'unresolved' }
	| { kind: 'closed'; settlement: Settlement }
export type IntegrityReport = { request: IntegrityRequest; status: IntegrityStatus }
export type IntegrityStatusEvent = { type: 'INTEGRITY_STATUS'; report: IntegrityReport }
export type IntegrityRecipient = ActorRef<Snapshot<unknown>, IntegrityStatusEvent>

/** Correlation equality only. The readiness machine owns access policy. */
export function sameIntegrityBinding(
	currentBinding: IntegrityBinding | undefined,
	incomingBinding: IntegrityBinding | undefined
) {
	return (
		currentBinding?.userId === incomingBinding?.userId &&
		currentBinding?.organizationId === incomingBinding?.organizationId &&
		currentBinding?.profileId === incomingBinding?.profileId &&
		currentBinding?.membershipId === incomingBinding?.membershipId &&
		currentBinding?.role === incomingBinding?.role &&
		currentBinding?.accountAccessMode === incomingBinding?.accountAccessMode
	)
}
export function sameIntegrityRequest(
	currentRequest: IntegrityRequest,
	incomingRequest: IntegrityRequest
) {
	return (
		currentRequest.generation === incomingRequest.generation &&
		sameIntegrityBinding(currentRequest.binding, incomingRequest.binding)
	)
}
export type WorkspaceIntegrityView = {
	mode: 'waiting' | 'working' | 'complete' | 'partial' | 'conflict' | 'failed'
	canRetry: boolean
}
export function selectWorkspaceIntegrityView(
	report: IntegrityReport | undefined
): WorkspaceIntegrityView {
	const kind = report?.status.kind
	if (kind === 'checking') return { mode: 'working', canRetry: false }
	if (kind === 'complete') return { mode: 'complete', canRetry: false }
	if (kind === 'partial' || kind === 'conflict') return { mode: kind, canRetry: true }
	if (kind === 'failed' || kind === 'unresolved' || kind === 'unavailable')
		return { mode: 'failed', canRetry: true }
	return { mode: 'waiting', canRetry: false }
}
