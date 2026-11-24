import type { LibraryCapability } from './library.js'
import type {
	SessionRuntimeConnection,
	SessionRuntimeObservation
} from 'delightful-local-first/session/runtime'
import type {
	RecoveryPhraseCapability,
	RecoveryScopeSource
} from 'delightful-local-first/recovery/contracts'

export type RootWrite = Readonly<{ local: () => Promise<void>; global: () => Promise<void> }>
export type RootAccess = Readonly<{
	read: () => Promise<'compatible' | 'missing' | 'incompatible'>
	ensure: () => RootWrite
}>
/** Ongoing local native evidence; bootstrap completion is not an access grant. */
export type WorkspaceAccess = Readonly<{
	workspaceId: string
	subscribe: (
		publish: (access: 'allowed' | 'unknown' | 'denied') => void,
		failed: () => void
	) => () => void
}>
export type RecoveryBinding = Readonly<{
	source: RecoveryScopeSource
	capability: RecoveryPhraseCapability
}>
/** Native binding lifetime; library allocation waits for domain admission. */
export type AccountCapabilities = Readonly<{
	root: RootAccess
	access: WorkspaceAccess
	recovery: RecoveryBinding
	createLibrary: (live: () => boolean) => LibraryCapability
}>
export type AccountObservation = SessionRuntimeObservation<AccountCapabilities>
export type ReadyAccountObservation = Extract<AccountObservation, { status: 'ready' }>
export type AccountBinding = Readonly<{
	observation: ReadyAccountObservation
	scope: import('delightful-local-first/workspace/contracts').WorkspaceSelectionScope
}>
export type AccountInput = Readonly<{
	session: SessionRuntimeConnection<AccountCapabilities>
	parsePhrase: (phrase: string) => Promise<string>
	signOut?: () => Promise<void>
}>
export function sameAccountBinding(left: AccountObservation, right: AccountObservation) {
	return (
		left.status === 'ready' &&
		right.status === 'ready' &&
		left.binding === right.binding &&
		left.identityId === right.identityId &&
		left.capabilities.access.workspaceId === right.capabilities.access.workspaceId
	)
}
