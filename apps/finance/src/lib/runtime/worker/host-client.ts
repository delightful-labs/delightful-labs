import type { RuntimeSourcesConfig } from 'jazz-tools'
import {
	HOST_PROTOCOL_VERSION,
	HOST_REQUEST_TIMEOUT_MS,
	MAX_HOST_REQUESTS,
	WorkerHostError,
	hostFailureSchema,
	hostReplySchema,
	hostRequestSchema,
	hostScopeSchema,
	type HostCommand,
	type HostFailureReason,
	type HostReply
} from './host-protocol.js'

type Pending = {
	sequence: number
	write: boolean
	expected: HostReply['type']
	timer: ReturnType<typeof setTimeout>
	resolve: (reply: HostReply) => void
	reject: (error: WorkerHostError) => void
}
/** Low-level correlated native requests only. Account read/transform/write decisions and
 * Web Lock ownership belong to the account-store chart, not this transport. */
export function createWorkerHostClient(port: MessagePort, scope: string, onFailure: () => void) {
	hostScopeSchema.parse(scope)
	const pending = new Map<string, Pending>()
	let sequence = 0
	let closed = false
	function close(reason: HostFailureReason = 'closed') {
		if (closed) return
		closed = true
		port.removeEventListener('message', receive)
		port.removeEventListener('messageerror', lost)
		port.close()
		for (const call of pending.values()) {
			clearTimeout(call.timer)
			call.reject(new WorkerHostError(reason, call.write ? 'unknown' : 'not-issued'))
		}
		pending.clear()
	}
	function fail(reason: HostFailureReason) {
		if (closed) return
		close(reason)
		onFailure()
	}
	function lost() {
		fail('unavailable')
	}
	function receive(event: MessageEvent<unknown>) {
		const failed = hostFailureSchema.safeParse(event.data)
		if (failed.success && failed.data.scope === scope) {
			for (const transferred of event.ports) transferred.close()
			fail('unavailable')
			return
		}
		const decoded = hostReplySchema.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) {
			for (const transferred of event.ports) transferred.close()
			return
		}
		const reply = decoded.data,
			call = pending.get(reply.requestId)
		if (closed || !call || call.sequence !== reply.sequence) {
			for (const transferred of event.ports) transferred.close()
			if (reply.type === 'BROKER') reply.port.close()
			return
		}
		for (const transferred of event.ports)
			if (reply.type !== 'BROKER' || transferred !== reply.port) transferred.close()
		clearTimeout(call.timer)
		pending.delete(reply.requestId)
		if (reply.type === 'FAILED')
			call.reject(
				new WorkerHostError(
					reply.reason,
					call.write && reply.reason !== 'rejected' ? 'unknown' : 'not-issued'
				)
			)
		else if (reply.type !== call.expected) {
			if (reply.type === 'BROKER') reply.port.close()
			call.reject(new WorkerHostError('invalid-reply', call.write ? 'unknown' : 'not-issued'))
			fail('invalid-reply')
		} else call.resolve(reply)
	}
	port.addEventListener('message', receive)
	port.addEventListener('messageerror', lost)
	port.start()
	function request(command: HostCommand, expected: HostReply['type']) {
		return new Promise<HostReply>((resolve, reject) => {
			if (closed || pending.size >= MAX_HOST_REQUESTS) {
				reject(new WorkerHostError(closed ? 'closed' : 'overloaded', 'not-issued'))
				return
			}
			const requestId = crypto.randomUUID()
			const message = hostRequestSchema.safeParse({
				...command,
				version: HOST_PROTOCOL_VERSION,
				scope,
				requestId,
				sequence: sequence + 1
			})
			if (!message.success) {
				reject(new WorkerHostError('rejected', 'not-issued'))
				return
			}
			const timer = setTimeout(() => fail('timeout'), HOST_REQUEST_TIMEOUT_MS)
			pending.set(requestId, {
				sequence: message.data.sequence,
				write:
					command.type === 'WRITE_ACCOUNT' ||
					command.type === 'WRITE_EARLIER' ||
					command.type === 'WRITE_GENERATION',
				expected,
				timer,
				resolve,
				reject
			})
			try {
				port.postMessage(message.data)
				sequence = message.data.sequence
			} catch {
				clearTimeout(timer)
				pending.delete(requestId)
				reject(new WorkerHostError('unavailable', 'not-issued'))
				fail('unavailable')
			}
		})
	}
	return {
		scope,
		accountStorage: {
			readSnapshot: async () => {
				const reply = await request({ type: 'READ_ACCOUNT_SNAPSHOT' }, 'SNAPSHOT')
				if (reply.type !== 'SNAPSHOT') throw new WorkerHostError('invalid-reply', 'not-issued')
				return reply.snapshot
			},
			readEarlier: async (key: string) => {
				const reply = await request({ type: 'READ_EARLIER', key }, 'ACCOUNT')
				if (reply.type !== 'ACCOUNT') throw new WorkerHostError('invalid-reply', 'not-issued')
				return reply.value
			},
			writeEarlier: async (key: string, value: string) => {
				await request({ type: 'WRITE_EARLIER', key, value }, 'WRITTEN')
			},
			read: async () => {
				const reply = await request({ type: 'READ_ACCOUNT' }, 'ACCOUNT')
				if (reply.type !== 'ACCOUNT') throw new WorkerHostError('invalid-reply', 'not-issued')
				return reply.value
			},
			write: async (value: string) => {
				await request({ type: 'WRITE_ACCOUNT', value }, 'WRITTEN')
			}
		},
		broker: {
			open: async (url: string, name: string) => {
				const reply = await request({ type: 'OPEN_BROKER', url, name }, 'BROKER')
				if (reply.type !== 'BROKER') throw new WorkerHostError('invalid-reply', 'not-issued')
				return { port: reply.port }
			},
			readGeneration: async (key: string) => {
				const reply = await request({ type: 'READ_GENERATION', key }, 'GENERATION')
				if (reply.type !== 'GENERATION') throw new WorkerHostError('invalid-reply', 'not-issued')
				return reply.value
			},
			writeGeneration: async (key: string, value: string) => {
				await request({ type: 'WRITE_GENERATION', key, value }, 'WRITTEN')
			}
		} satisfies NonNullable<RuntimeSourcesConfig['browserWorkerHost']>,
		close: () => close()
	}
}
