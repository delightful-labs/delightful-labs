import type { Organization } from '../schema.js'
import type { ActorRef, Snapshot } from 'xstate'

export { sameInitializationRequest } from 'delightful-local-first/workspace/startup-contracts'
export type {
	WorkspaceSessionFacts,
	InitializationRequest,
	InitializationStatus,
	InitializationReport,
	InitializationStatusEvent,
	InitializationRecipient
} from 'delightful-local-first/workspace/startup-contracts'
export type WorkspaceRoute = { pathname: string; search: string; hash: string }
export type NavigationAccess = 'waiting' | 'ready' | 'denied' | 'failed'
export type WorkspaceNavigationFacts = WorkspaceRoute & {
	generation: number
	userId: string | undefined
	ready: boolean
	loading: boolean
	error: unknown
	organizations: readonly Organization[]
	access: NavigationAccess
}
export type NavigationStatus =
	'waiting' | 'directory' | 'global' | 'scoped' | 'unavailable' | 'failed'
export type NavigationReport = { generation: number; status: NavigationStatus }
export type NavigationStatusEvent = { type: 'NAVIGATION_STATUS'; report: NavigationReport }
export type NavigationRecipient = ActorRef<Snapshot<unknown>, NavigationStatusEvent>
export type WorkspaceNavigate = (
	url: string,
	signal: AbortSignal,
	expectedHref: string,
	replace: boolean
) => Promise<void>
