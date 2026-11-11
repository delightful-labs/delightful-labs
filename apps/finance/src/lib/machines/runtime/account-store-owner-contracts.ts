import type { AccountStoreRequest, AccountStoreResult } from './account-store-contracts.js'

export const MAX_ACCOUNT_STORE_REQUESTS = 8
export type AccountStoreResponse =
	AccountStoreResult | { kind: 'unavailable'; reason: 'closed' | 'overloaded' }
/** Worker-local callback capability; never sent over a port or persisted. */
export type AccountStoreEnvelope = {
	request: AccountStoreRequest
	respond: (result: AccountStoreResponse) => void
}
