import { createCallbackLogic } from 'xstate'
import type {
	SessionRuntimeConnection,
	SessionRuntimeView
} from '../../contracts/session-runtime.js'

export const sessionRuntimeObservation = createCallbackLogic<never, SessionRuntimeConnection>(
	({ input, sendBack }) => {
		let active = true
		const publish = (view: SessionRuntimeView) => {
			if (active) sendBack({ type: 'OBSERVED', view })
		}
		const read = () => {
			try {
				publish(input.view.get())
			} catch {
				if (active) sendBack({ type: 'FAILED' })
			}
		}
		const subscription = input.view.subscribe({
			next: publish,
			error: () => {
				if (active) sendBack({ type: 'FAILED' })
			},
			complete: read
		})
		read()
		return () => {
			active = false
			subscription.unsubscribe()
		}
	}
)
