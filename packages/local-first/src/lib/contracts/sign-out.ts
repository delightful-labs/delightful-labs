/** Feedback bounds, never proof that an issued identity effect was cancelled. */
export const DEFAULT_SIGN_OUT_DEADLINE_MS = 30_000
export type SignOutStage = 'provider' | 'session'
export type SignOutSessionStatus = 'current' | 'signed-out' | 'replaced' | 'unavailable'
export type OrderedSignOutInput = Readonly<{
	provider?: () => Promise<void>
	/** Synchronous native facts, observed after provider settlement and before mutation. */
	observeSession?: () => SignOutSessionStatus
	session: () => Promise<void>
	providerDeadlineMs?: number
	sessionDeadlineMs?: number
	onOverdue?: (stage: SignOutStage) => void
}>
/** The caller refreshes native identity after settlement before admitting retry. */
export type OrderedSignOutResult =
	| { outcome: 'completed' }
	| { outcome: 'failed'; stage: SignOutStage | 'configuration' }
