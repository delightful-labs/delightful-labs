/** Worker-local contracts, never wire DTOs or persisted actor snapshots. */
export const MAX_INDEXEDDB_ACCOUNT_CALLS = 8
export const MAX_INDEXEDDB_ACCOUNT_VALUE_LENGTH = 1024 * 1024
export type IndexedDbAccountResult =
	| { kind: 'read'; value: string | null }
	| { kind: 'updated' }
	| {
			kind: 'failed'
			reason: 'closed' | 'overloaded' | 'unavailable' | 'invalid-value'
			outcome: 'not-issued' | 'aborted' | 'unknown'
	  }
export type IndexedDbAccountOperation =
	| { kind: 'read' }
	| { kind: 'update'; transform: (current: string | null) => string }
export type IndexedDbAccountCall = {
	id: number
	operation: IndexedDbAccountOperation
	respond: (result: IndexedDbAccountResult) => void
}
export type IndexedDbAccountNativeEvent =
	| { type: 'OPENED' | 'OPEN_FAILED' | 'INVALIDATED' }
	| { type: 'SETTLED'; id: number; result: IndexedDbAccountResult }
export type IndexedDbAccountNative = {
	/** Original native close receipt, retained even if its actor stops. */
	closed: Promise<void>
	listen: (report: (event: IndexedDbAccountNativeEvent) => void) => () => void
	open: () => void
	perform: (call: IndexedDbAccountCall) => void
	close: () => void
}
