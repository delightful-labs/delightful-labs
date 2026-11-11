import type { JazzSession } from 'jazz-tools/svelte'
import type { SessionReadinessBinding } from '../../contracts/session.js'

/** Bind the host's acquired session without reading, subscribing, creating, or replacing it. */
export function createJazzSessionReadinessAdapter<Client>(
	session: JazzSession<Client>
): SessionReadinessBinding {
	return {
		binding: Object.freeze({}),
		capability: {
			readStatus: () => session.getSnapshot().status,
			subscribe: (notify) => session.subscribe(notify),
			retry: () => session.retry()
		}
	}
}
