import type { ActorRef, Snapshot } from 'xstate'

/** Bootstrap provenance identifies an initial target; it does not grant current access. */
export type WorkspaceInitializationProvenance = Readonly<{
	identityId: string
	initialWorkspaceId: string
}>
export type WorkspaceInitializationSettlement = 'notStarted' | 'locallyPersisted' | 'unresolved'
export type WorkspaceInitializationReport<Result> = Readonly<{
	type: 'WORKSPACE_INITIALIZATION_RESULT'
	binding: object
	initialization: Result
	provenance: WorkspaceInitializationProvenance | undefined
}>
export type WorkspaceStartupInput<Input, Result> = Readonly<{
	binding: object
	initialization: Input
	recipient: ActorRef<Snapshot<unknown>, WorkspaceInitializationReport<Result>>
}>
export type WorkspaceStartupResult<Result> = Readonly<{
	outcome: 'closed' | 'unresolved'
	initialization: Result | undefined
	provenance: WorkspaceInitializationProvenance | undefined
}>
