import type { signInView } from './signin-machine.js'
import type { z } from 'zod'
import type { connectMessageSchema } from './protocol.js'
import { confirmConnection } from './connect.js'

export type ConnectionView = ReturnType<typeof signInView> & {
	canRestore: boolean
	canRetry: boolean
}
export type AccountWorkerReply =
	| (Omit<z.infer<typeof connectMessageSchema>, 'type'> & { type: 'CONFIRM'; id: string })
	| (ConnectionView & { type: 'CONNECTION_VIEW' })
/** Native Window effects only. Worker owns validation, restoration and connection
 * sequencing; no SDK/account objects or recovery credentials return in views. */
export function accountWorker(
	worker: Worker,
	render: (view: ConnectionView) => void = () => {},
	onClosed: () => void = () => {}
) {
	const channel = new MessageChannel()
	channel.port1.onmessage = ({ data }: MessageEvent<AccountWorkerReply>) => {
		if (data.type === 'CONFIRM') {
			void confirmConnection(data.accountId, data.requestId).then(
				() => channel.port1.postMessage({ type: 'CONFIRMED', id: data.id, accepted: true }),
				() => channel.port1.postMessage({ type: 'CONFIRMED', id: data.id, accepted: false })
			)
		} else if (data.type === 'CONNECTION_VIEW') render(data)
	}
	channel.port1.start()
	worker.postMessage(
		{
			type: 'EXTENSION_INITIALIZE',
			port: channel.port2,
			request: new URLSearchParams(location.search).get('request')
		},
		[channel.port2]
	)
	return {
		worker,
		post: (event: { type: 'RESTORE'; phrase: string } | { type: 'RETRY' }) =>
			channel.port1.postMessage(event),
		release: () => {
			channel.port1.onmessage = null
			channel.port1.close()
			// The shared UI client releases this adapter after the primary CLOSED
			// receipt, once the worker's native owners have drained. A second port's
			// close message could otherwise lose the race with its own disposal.
			onClosed()
		}
	}
}
