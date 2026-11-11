/** One host identity/client attachment. Rebinding requires a new actor after drain. */
export type WorkspaceSelectionScope = Readonly<{ binding: object; attachment: object }>
export type WorkspaceSelectionRequest = Readonly<{ workspaceId: string; attempt: number }>
export type WorkspaceDirectory =
	| Readonly<{ status: 'loading' | 'unavailable' | 'failed' }>
	| Readonly<{ status: 'available'; entries: readonly Readonly<{ id: string; name: string }>[] }>
/** Directory absence is not denial. The integration supplies target-specific access evidence. */
export type WorkspaceSelectionObservation = Readonly<{
	scope: WorkspaceSelectionScope
	request: WorkspaceSelectionRequest
	generation: number
	directory: WorkspaceDirectory
	access: 'allowed' | 'denied' | 'unknown' | 'unavailable' | 'failed'
}>
export type WorkspaceLease = Readonly<{
	scope: WorkspaceSelectionScope
	request: WorkspaceSelectionRequest
	epoch: number
}>
export type WorkspaceDrainRequest = Readonly<{
	token: object
	lease: WorkspaceLease
}>
export type WorkspaceSelectionEvent =
	| Readonly<{ type: 'BIND'; scope: WorkspaceSelectionScope }>
	| Readonly<{ type: 'SELECT'; scope: WorkspaceSelectionScope; request: WorkspaceSelectionRequest }>
	| Readonly<{ type: 'OBSERVED'; observation: WorkspaceSelectionObservation }>
	| Readonly<{ type: 'SUSPEND'; scope: WorkspaceSelectionScope }>
	| Readonly<{ type: 'RESUME' | 'RETRY'; observation: WorkspaceSelectionObservation }>
	| Readonly<{ type: 'DRAINED'; drain: WorkspaceDrainRequest }>
	| Readonly<{
			type: 'DRAIN_FAILED'
			drain: WorkspaceDrainRequest
			outcome: 'released' | 'unresolved'
	  }>
	| Readonly<{ type: 'SHUTDOWN' }>
export type WorkspaceSelectionReport =
	| Readonly<{
			type: 'WORKSPACE_SELECTION'
			scope: WorkspaceSelectionScope
			request: WorkspaceSelectionRequest | undefined
			status: 'waiting' | 'denied' | 'unavailable' | 'failed' | 'suspended' | 'drainFailed'
			directory: WorkspaceDirectory | undefined
	  }>
	| Readonly<{
			type: 'WORKSPACE_SELECTION'
			status: 'selected'
			lease: WorkspaceLease
			directory: WorkspaceDirectory
	  }>
	| Readonly<{ type: 'WORKSPACE_SCOPE_INVALIDATED'; lease: WorkspaceLease }>
	| Readonly<{ type: 'WORKSPACE_DRAIN_REQUESTED'; drain: WorkspaceDrainRequest }>
	| Readonly<{
			type: 'WORKSPACE_DRAIN_FAILED'
			drain: WorkspaceDrainRequest
			outcome: 'released' | 'unresolved'
	  }>
export type WorkspaceSelectionOutput =
	| Readonly<{ outcome: 'closed' }>
	| Readonly<{ outcome: 'unresolved'; drain: WorkspaceDrainRequest }>
