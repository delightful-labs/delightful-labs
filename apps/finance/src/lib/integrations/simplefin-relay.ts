export type RelayRequest = { operation: 'claim' | 'discover' | 'sync'; url: string }

/** Shared HTTP leaf; callers own destination validation and response decisions. */
export function requestRelay(
	endpoint: string,
	body: RelayRequest,
	signal: AbortSignal,
	traceId: string
) {
	signal.throwIfAborted()
	return fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Bank-Sync-Trace': traceId },
		body: JSON.stringify(body),
		signal,
		cache: 'no-store',
		credentials: 'same-origin'
	})
}
