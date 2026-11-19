import type { JazzSession } from 'jazz-tools/client'
import type {
	SessionReadinessBinding,
	SessionReadinessCapability
} from '../../contracts/session.js'

/** Bind the host's acquired session without reading, subscribing, creating, or replacing it. */
export function createJazzSessionReadinessAdapter<Client>(
	session: Pick<JazzSession<Client>, 'getSnapshot' | 'subscribe' | 'retry'>
): SessionReadinessBinding & {
	capability: Extract<SessionReadinessCapability, { retry: () => Promise<void> }>
} {
	return {
		binding: Object.freeze({}),
		capability: {
			readStatus: () => session.getSnapshot().status,
			subscribe: (notify) => session.subscribe(notify),
			retry: () => session.retry()
		}
	}
}
