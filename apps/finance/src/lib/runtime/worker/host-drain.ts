import { z } from 'zod'
import {
	HOST_PROTOCOL_VERSION,
	HOST_REQUEST_TIMEOUT_MS,
	WorkerHostError,
	hostScopeSchema
} from './host-protocol.js'

const correlation = z.object({
	version: z.literal(HOST_PROTOCOL_VERSION),
	scope: hostScopeSchema,
	requestId: z.string().uuid()
})
const closeRequest = correlation.extend({ type: z.literal('CLOSE_HOST') }).strict()
const closeReceipt = correlation.extend({ type: z.literal('HOST_CLOSED') }).strict()

/** Independent of the data port: that port may already have failed. closeHost
 * must be the synchronous disposer returned by serveWindowHost in this realm. */
export function serveWindowHostDrain(port: MessagePort, scope: string, closeHost: () => void) {
	hostScopeSchema.parse(scope)
	function receive(event: MessageEvent<unknown>) {
		for (const transferred of event.ports) transferred.close()
		if (event.ports.length) return
		const decoded = closeRequest.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		try {
			// Window events cannot interleave a synchronous storage primitive with
			// this disposer. No queued data-port message can write after it returns.
			closeHost()
			port.postMessage({ ...decoded.data, type: 'HOST_CLOSED' })
		} catch {
			// No receipt is safer than falsely releasing an uncertain write's lock.
			// The requester has a bounded deadline; never acknowledge failed close.
		}
	}
	port.addEventListener('message', receive)
	port.start()
	return () => {
		port.removeEventListener('message', receive)
		port.close()
	}
}

/** A receipt settles the request AND reports late closure after a timeout.
 * The owning chart decides when to release custody; disposal is never a receipt. */
export function createWorkerHostDrain(
	port: MessagePort,
	scope: string,
	onClosed: (scope: string) => void
) {
	hostScopeSchema.parse(scope)
	const requestId = crypto.randomUUID()
	let pending: ReturnType<typeof Promise.withResolvers<void>> | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	let disposed = false
	function dispose() {
		if (disposed) return
		disposed = true
		clearTimeout(timer)
		port.removeEventListener('message', receive)
		port.removeEventListener('messageerror', lost)
		port.close()
		pending?.reject(new WorkerHostError('closed', 'unknown'))
	}
	function lost() {
		clearTimeout(timer)
		pending?.reject(new WorkerHostError('unavailable', 'unknown'))
		// Keep the independent receipt listener alive until its owner disposes it.
	}
	function receive(event: MessageEvent<unknown>) {
		for (const transferred of event.ports) transferred.close()
		if (disposed || !pending || event.ports.length) return
		const decoded = closeReceipt.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope || decoded.data.requestId !== requestId)
			return
		pending.resolve()
		dispose()
		onClosed(scope)
	}
	port.addEventListener('message', receive)
	port.addEventListener('messageerror', lost)
	port.start()
	return {
		scope,
		closeHostAndDrain() {
			if (pending) return pending.promise
			if (disposed) return Promise.reject(new WorkerHostError('closed', 'unknown'))
			pending = Promise.withResolvers<void>()
			timer = setTimeout(
				() => pending?.reject(new WorkerHostError('timeout', 'unknown')),
				HOST_REQUEST_TIMEOUT_MS
			)
			try {
				port.postMessage({
					version: HOST_PROTOCOL_VERSION,
					scope,
					requestId,
					type: 'CLOSE_HOST'
				})
			} catch {
				lost()
			}
			return pending.promise
		},
		dispose
	}
}
