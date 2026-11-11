import type {
	WorkspaceDrainRequest,
	WorkspaceLease
} from 'delightful-local-first/workspace/contracts'
import type { BankEvent, BankObservationEvent } from '../machines/bank-sync/types.js'
import type { IntegrityRequest, IntegrityReport } from './workspace-integrity-contract.js'
import type { WorkspaceResourceRelease } from './workspace-resource-release.js'
import type { ActorRef, Snapshot } from 'xstate'

export type SelectedResourceReport =
	| { type: 'SELECTED_RESOURCES_STOPPING'; lease: WorkspaceLease; resource: 'bank' | 'integrity' }
	| { type: 'SELECTED_INTEGRITY_STATUS'; lease: WorkspaceLease; report: IntegrityReport }
	| {
			type: 'SELECTED_RESOURCE_DRAIN_REJECTED'
			lease: WorkspaceLease
			drain: WorkspaceDrainRequest
			reason: 'scopeMismatch' | 'busy'
	  }
export type SelectedResourceRecipient = ActorRef<Snapshot<unknown>, SelectedResourceReport>
export type SelectedResourceCommand =
	| {
			type: 'BANK'
			lease: WorkspaceLease
			event: BankEvent | BankObservationEvent | { type: 'NETWORK_CHANGED'; offline: boolean }
	  }
	| { type: 'INTEGRITY'; lease: WorkspaceLease; request: IntegrityRequest }
	| { type: 'DRAIN'; drain: WorkspaceDrainRequest }
	| { type: 'SHUTDOWN' }
export type SelectedResourceOutput = Readonly<{
	lease: WorkspaceLease
	drain: WorkspaceDrainRequest | undefined
	release: WorkspaceResourceRelease
}>

/** Correlation only; equal workspace IDs do not make another lease current. */
export function sameWorkspaceLease(left: WorkspaceLease, right: WorkspaceLease) {
	return (
		left.scope.binding === right.scope.binding &&
		left.scope.attachment === right.scope.attachment &&
		left.request.workspaceId === right.request.workspaceId &&
		left.request.attempt === right.request.attempt &&
		left.epoch === right.epoch
	)
}
