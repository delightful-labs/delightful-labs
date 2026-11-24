import type {
	WorkspaceDrainRequest,
	WorkspaceLease,
	WorkspaceSelectionEvent,
	WorkspaceSelectionReport,
	WorkspaceSelectionScope
} from './workspace-selection.js'

export type WorkspaceResourceInput<Binding> = Readonly<{
	scope: WorkspaceSelectionScope
	binding: Binding
}>
export type WorkspaceResourceCommand<Event extends { type: string }> =
	| Exclude<WorkspaceSelectionEvent, { type: 'BIND' | 'DRAINED' | 'DRAIN_FAILED' }>
	| Readonly<{
			type: 'RESOURCE_COMMAND'
			lease: WorkspaceLease
			command: Exclude<Event, { type: 'SHUTDOWN' }>
	  }>
export type WorkspaceResourceCompletion<Result> = Readonly<{
	output: Result | undefined
	settlement: 'released' | 'unresolved'
}>
export type WorkspaceResourceFailure = Readonly<{
	reason:
		| 'resourceFailed'
		| 'resourceCrashed'
		| 'unexpectedCompletion'
		| 'unresolvedReceipt'
		| 'selectorFailed'
		| 'selectorClosed'
		| 'selectorUnresolved'
		| 'ownerStopped'
}>
export type WorkspaceResourceReport<View, Result> = Readonly<{
	scope: WorkspaceSelectionScope
	selection: WorkspaceSelectionReport | undefined
	completion: WorkspaceResourceCompletion<Result> | undefined
}> &
	(
		| Readonly<{
				status: 'waiting' | 'closing' | 'closed'
				lease: undefined
				drain: undefined
				view: undefined
		  }>
		| Readonly<{
				status: 'active'
				lease: WorkspaceLease
				drain: undefined
				view: View | undefined
		  }>
		| Readonly<{
				status: 'draining' | 'closing'
				lease: WorkspaceLease
				drain: WorkspaceDrainRequest | undefined
				view: undefined
		  }>
		| Readonly<{
				status: 'unresolved'
				lease: WorkspaceLease | undefined
				drain: WorkspaceDrainRequest | undefined
				view: undefined
				failure: WorkspaceResourceFailure
		  }>
	)
