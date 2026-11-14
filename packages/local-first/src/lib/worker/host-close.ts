import { z } from 'zod'
import type {
	WorkerChannelControl,
	WorkerHostClosed,
	WorkerHostCloseFailure
} from '../contracts/worker-channel.js'
import {
	WORKER_HOST_PROTOCOL_VERSION,
	hostScopeSchema,
	hostIdentitySchema,
	hostEnvelopeSchema
} from './host-close-protocol.js'

export { WORKER_HOST_PROTOCOL_VERSION } from './host-close-protocol.js'
const closeRequest = hostEnvelopeSchema.extend({ type: z.literal('CLOSE_HOST') }).strict()
const closeReceipt = hostEnvelopeSchema.extend({ type: z.literal('HOST_CLOSED') }).strict()
const closeFailure = hostEnvelopeSchema
	.extend({ type: z.literal('HOST_CLOSE_FAILED'), stage: z.enum(['dispose', 'acknowledge']) })
	.strict()
const closeReport = z.discriminatedUnion('type', [closeReceipt, closeFailure])
export type HostCloseIdentity = WorkerHostClosed
export type HostCloseFailure = WorkerHostCloseFailure
export type HostControlReport = WorkerChannelControl

/** One synchronous native post attempt, without retry or lifecycle selection. */
function postControl(port: MessagePort, message: z.infer<typeof closeReport>) {
	try {
		port.postMessage(message)
		return true
	} catch {
		return false
	}
}

/** Window native boundary for the shared channel's selected close command.
 * closeHost is the synchronous data-host disposer; it must leave this independent
 * control port alive. Only its successful return permits a close receipt.
 * Native failure facts cross the control port; the Worker chart owns the outcome. */
export function serveHostClose(port: MessagePort, scope: string, closeHost: () => void) {
	hostScopeSchema.parse(scope)
	let disposed = false
	const receive = (event: MessageEvent<unknown>) => {
		for (const resource of event.ports) resource.close()
		if (disposed || event.ports.length) return
		const decoded = closeRequest.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		try {
			closeHost()
		} catch {
			postControl(port, { ...decoded.data, type: 'HOST_CLOSE_FAILED', stage: 'dispose' })
			return
		}
		if (!postControl(port, { ...decoded.data, type: 'HOST_CLOSED' }))
			postControl(port, { ...decoded.data, type: 'HOST_CLOSE_FAILED', stage: 'acknowledge' })
		// If the control port cannot deliver either report, no additional native
		// retry or success is inferred. The owning chart retains its close deadline.
	}
	port.addEventListener('message', receive)
	port.start()
	return () => {
		if (disposed) return
		disposed = true
		port.removeEventListener('message', receive)
		port.close()
	}
}

/** Worker native capabilities only: the shared chart selects posting, deadlines
 * and receipt admission. Transport errors do not remove the late-receipt listener. */
export function workerHostControl(port: MessagePort, scope: string) {
	hostScopeSchema.parse(scope)
	return {
		listen(report: (event: HostControlReport) => void) {
			let disposed = false
			const failed = () => {
				if (!disposed) report({ type: 'CLOSE_FAILED', scope })
			}
			const receive = (event: MessageEvent<unknown>) => {
				for (const resource of event.ports) resource.close()
				if (disposed) return
				const decoded = closeReport.safeParse(event.data)
				if (event.ports.length || !decoded.success) {
					failed()
					return
				}
				if (decoded.data.scope !== scope) return
				if (decoded.data.type === 'HOST_CLOSE_FAILED') {
					report({
						type: 'HOST_CLOSE_FAILED',
						failure: { scope, requestId: decoded.data.requestId, stage: decoded.data.stage }
					})
					return
				}
				report({ type: 'HOST_CLOSED', receipt: { scope, requestId: decoded.data.requestId } })
			}
			port.addEventListener('message', receive)
			port.addEventListener('messageerror', failed)
			port.start()
			return () => {
				if (disposed) return
				disposed = true
				port.removeEventListener('message', receive)
				port.removeEventListener('messageerror', failed)
				port.close()
			}
		},
		post(identity: HostCloseIdentity) {
			const decoded = hostIdentitySchema.safeParse(identity)
			if (!decoded.success || decoded.data.scope !== scope)
				throw new Error('Invalid host close identity')
			port.postMessage({
				...decoded.data,
				version: WORKER_HOST_PROTOCOL_VERSION,
				type: 'CLOSE_HOST'
			})
		}
	}
}
