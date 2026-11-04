import { fromCallback } from 'xstate'
import type { RestorePreparationInput } from '../../backup/restore-preparation.js'

export type LockEvent = { type: 'LOCK_ACQUIRED' | 'LOCK_UNAVAILABLE' | 'LOCK_FAILED' }
/** Native lock callback holds one acquired resource. The enclosing state owns its lifetime. */
export const operationLock = fromCallback<{ type: string }, RestorePreparationInput>(
	({ input, sendBack }) => {
		let release: (() => void) | undefined
		const held = new Promise<void>((resolve) => {
			release = resolve
		})
		const key = JSON.stringify([
			'dlf-restore',
			input.binding.applicationId,
			input.binding.environment,
			input.binding.identityId,
			input.binding.operationId
		])
		// Acquiring an unsupported browser primitive is an unavailable operation, never unlocked writes.
		if (!globalThis.navigator?.locks) {
			sendBack({ type: 'LOCK_UNAVAILABLE' })
			return
		}
		void navigator.locks
			.request(key, { mode: 'exclusive', ifAvailable: true }, (lock) => {
				if (!lock) {
					sendBack({ type: 'LOCK_UNAVAILABLE' })
					return
				}
				sendBack({ type: 'LOCK_ACQUIRED' })
				return held
			})
			.catch(() => sendBack({ type: 'LOCK_FAILED' }))
		return () => {
			release?.()
		}
	}
)
