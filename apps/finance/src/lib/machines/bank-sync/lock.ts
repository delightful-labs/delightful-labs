import type { LockEvent } from './types.js'
import { createCallbackLogic } from 'xstate'

export const bankLock = createCallbackLogic<
	LockEvent,
	{ ownerId: string | undefined; organizationId: string | null }
>(({ input, sendBack }) => {
	let release: () => void = () => {}
	let disposed = false
	const held = new Promise<void>((resolve) => {
		release = resolve
	})
	if (!navigator.locks || !input.ownerId || !input.organizationId) {
		sendBack({ type: 'LOCK_FAILED', error: new Error('locking_unavailable') })
		return () => {
			disposed = true
			release()
		}
	}
	void navigator.locks
		.request(
			`simplefin:${input.ownerId}:${input.organizationId}`,
			{ ifAvailable: true },
			async (lock) => {
				if (disposed) return
				if (!lock) {
					sendBack({ type: 'LOCK_FAILED', error: new Error('other_tab') })
					return
				}
				sendBack({ type: 'LOCK_ACQUIRED' })
				await held
			}
		)
		.catch((error: unknown) => {
			if (!disposed) sendBack({ type: 'LOCK_FAILED', error })
		})
	return () => {
		disposed = true
		release()
	}
})
