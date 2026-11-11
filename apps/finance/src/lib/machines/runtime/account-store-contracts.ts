import type { AccountSelectionSnapshot } from '../../runtime/worker/account-selection.js'
import { WorkerHostError } from '../../runtime/worker/host-protocol.js'

/** Each method performs one selected native operation. readSnapshot returns raw
 * primary/eligible-earlier storage facts, without choosing or creating identity.
 * Legacy reads/writes must target the admitted earlier key under its Web Lock. */
export type AccountStoreStorage = {
	readonly scope: string
	readSnapshot: () => Promise<AccountSelectionSnapshot>
	writePrimary: (value: string) => Promise<void>
	readEarlier: (key: string) => Promise<string | null>
	writeEarlier: (key: string, value: string) => Promise<void>
	/** Resolve only after Window removed the old bridge listeners and acknowledged
	 * that no queued write can execute. A timeout/rejection is NOT this receipt. */
	closeHostAndDrain: () => Promise<void>
}
export type AccountStoreResult =
	| { kind: 'read'; value: string | null }
	| { kind: 'updated'; legacyCleanup: 'complete' | 'unavailable' }
	| { kind: 'failed'; writeOutcome: 'not-issued' | 'unknown' }
	| { kind: 'canceled' }
export type AccountStoreRequest =
	{ kind: 'read' } | { kind: 'update'; transform: (value: string | null) => string }
export function definitelyNotIssued(error: unknown) {
	return error instanceof WorkerHostError && error.writeOutcome === 'not-issued'
}
