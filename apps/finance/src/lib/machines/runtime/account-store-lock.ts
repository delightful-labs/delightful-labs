import { createCallbackLogic } from 'xstate'

export type AccountLockInput = { key: string; locks: Pick<LockManager, 'request'> }
/** Native Web Lock lease only. RELEASE acknowledges actual lock-request
 * settlement, including an aborted acquisition; it is not a write rollback. */
export const accountStoreLock = createCallbackLogic<{ type: 'RELEASE' }, AccountLockInput>(
	({ input, receive, sendBack }) => {
		const abort = new AbortController(),
			released = Promise.withResolvers<void>()
		let releaseRequested = false,
			disposed = false
		const release = () => {
			releaseRequested = true
			abort.abort()
			released.resolve()
		}
		receive(release)
		try {
			void input.locks
				.request(input.key, { signal: abort.signal }, async () => {
					if (!releaseRequested && !disposed) sendBack({ type: 'LOCKED' })
					await released.promise
				})
				.then(
					() => {
						if (!disposed) sendBack({ type: 'RELEASED' })
					},
					() => {
						if (!disposed) sendBack({ type: releaseRequested ? 'RELEASED' : 'LOCK_FAILED' })
					}
				)
		} catch {
			sendBack({ type: 'LOCK_FAILED' })
		}
		return () => {
			disposed = true
			release()
		}
	}
)
