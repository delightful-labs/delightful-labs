import { isEarlierSelectionKey, type AccountStorageBinding } from './account-storage-namespace.js'
import {
	HOST_PROTOCOL_VERSION,
	MAX_ACCOUNT_STORE_LENGTH,
	MAX_ACCOUNT_SNAPSHOT_LENGTH,
	MAX_HOST_BROKERS,
	MAX_STORAGE_SLOTS,
	MAX_EARLIER_STORES,
	accountSnapshotSchema,
	hostRequestSchema,
	hostScopeSchema,
	type HostReply
} from './host-protocol.js'

type BrokerHandle = Pick<SharedWorker, 'port' | 'addEventListener' | 'removeEventListener'>
export type WindowHostBinding = {
	scope: string
	accountStorageKey: string
	accountSelection?: AccountStorageBinding
	broker: { url: string; baseName: string }
}
type NativeHost = {
	origin: string
	storage: Pick<Storage, 'getItem' | 'setItem'>
	inventory?: Pick<Storage, 'length' | 'key'>
	openBroker: (url: string, name: string) => BrokerHandle
}

/** Window-only primitives on a private capability port. The worker selects the
 * operation; this adapter performs no SDK, identity, authorization or finance workflow. */
export function serveWindowHost(port: MessagePort, binding: WindowHostBinding, native: NativeHost) {
	hostScopeSchema.parse(binding.scope)
	const brokerUrl = new URL(binding.broker.url)
	if (
		(brokerUrl.protocol !== 'http:' && brokerUrl.protocol !== 'https:') ||
		brokerUrl.origin !== new URL(native.origin).origin ||
		brokerUrl.username ||
		brokerUrl.password
	)
		throw new Error('Invalid broker URL')
	if (
		!binding.broker.baseName.startsWith('jazz-runtime:') ||
		binding.broker.baseName.length > 65_500
	)
		throw new Error('Invalid broker binding')
	if (!binding.accountStorageKey || binding.accountStorageKey.length > 65_536)
		throw new Error('Invalid account storage binding')
	if (binding.accountSelection && binding.accountSelection.key !== binding.accountStorageKey)
		throw new Error('Mismatched account storage binding')
	const selectionBinding = binding.accountSelection ? { ...binding.accountSelection } : undefined
	const admittedEarlier = (key: string) =>
		selectionBinding !== undefined && isEarlierSelectionKey(selectionBinding, key)
	const generationKey = `jazz:shared-worker-generation:${binding.broker.baseName}`
	const workers = new Set<BrokerHandle>()
	let lastSequence = 0
	let closed = false
	const lost = () => {
		if (closed) return
		try {
			port.postMessage({
				version: HOST_PROTOCOL_VERSION,
				scope: binding.scope,
				type: 'HOST_FAILED'
			})
		} catch {
			/* The client also bounds loss of the native port with a deadline. */
		} finally {
			close()
		}
	}
	function close() {
		if (closed) return
		closed = true
		port.removeEventListener('message', receive)
		port.removeEventListener('messageerror', lost)
		for (const worker of workers) worker.removeEventListener('error', lost)
		workers.clear()
		port.close()
	}
	function reply(message: HostReply, transfers: Transferable[] = []) {
		try {
			port.postMessage(message, transfers)
		} catch {
			for (const transfer of transfers) if (transfer instanceof MessagePort) transfer.close()
			close()
		}
	}
	function receive(event: MessageEvent<unknown>) {
		// No command accepts transferred handles; close them even on malformed input.
		for (const transferred of event.ports) transferred.close()
		if (closed) return
		const decoded = hostRequestSchema.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== binding.scope) return
		const request = decoded.data
		const correlation = {
			version: request.version,
			scope: request.scope,
			requestId: request.requestId,
			sequence: request.sequence
		}
		if (request.sequence !== lastSequence + 1) {
			reply({ ...correlation, type: 'FAILED', reason: 'rejected' })
			return
		}
		// Port messages are FIFO. Consume the sequence before a fallible primitive so
		// a duplicate can never repeat a storage write or open another broker.
		lastSequence = request.sequence
		try {
			if (request.type === 'READ_ACCOUNT_SNAPSHOT') {
				const current = native.storage.getItem(binding.accountStorageKey)
				const earlier: { key: string; value: string | null }[] = []
				if (current !== null && current.length > MAX_ACCOUNT_STORE_LENGTH)
					throw new Error('Account store exceeds protocol bound')
				let snapshotLength = current?.length ?? 0
				if (selectionBinding?.earlierPathname) {
					const inventory = native.inventory
					if (!inventory) throw new Error('Storage inventory unavailable')
					const length = inventory.length
					if (!Number.isSafeInteger(length) || length < 0 || length > MAX_STORAGE_SLOTS)
						throw new Error('Storage inventory exceeds protocol bound')
					for (let index = 0; index < length; index++) {
						const key = inventory.key(index)
						if (key === null || !admittedEarlier(key)) continue
						if (earlier.length >= MAX_EARLIER_STORES || key.length > 65_536)
							throw new Error('Earlier inventory exceeds protocol bound')
						const value = native.storage.getItem(key)
						snapshotLength += key.length + (value?.length ?? 0)
						if (
							(value !== null && value.length > MAX_ACCOUNT_STORE_LENGTH) ||
							snapshotLength > MAX_ACCOUNT_SNAPSHOT_LENGTH
						)
							throw new Error('Account snapshot exceeds protocol bound')
						earlier.push({ key, value })
					}
				}
				const snapshot = accountSnapshotSchema.parse({ current, earlier })
				reply({ ...correlation, type: 'SNAPSHOT', snapshot })
				return
			}
			if (request.type === 'READ_EARLIER' || request.type === 'WRITE_EARLIER') {
				if (!admittedEarlier(request.key)) {
					reply({ ...correlation, type: 'FAILED', reason: 'rejected' })
					return
				}
				if (request.type === 'WRITE_EARLIER') {
					native.storage.setItem(request.key, request.value)
					reply({ ...correlation, type: 'WRITTEN' })
				} else {
					const value = native.storage.getItem(request.key)
					if (value !== null && value.length > MAX_ACCOUNT_STORE_LENGTH)
						throw new Error('Account store exceeds protocol bound')
					reply({ ...correlation, type: 'ACCOUNT', value })
				}
				return
			}
			if (request.type === 'READ_ACCOUNT') {
				const value = native.storage.getItem(binding.accountStorageKey)
				if (value !== null && value.length > MAX_ACCOUNT_STORE_LENGTH)
					throw new Error('Account store exceeds protocol bound')
				reply({ ...correlation, type: 'ACCOUNT', value })
				return
			}
			if (request.type === 'WRITE_ACCOUNT') {
				native.storage.setItem(binding.accountStorageKey, request.value)
				reply({ ...correlation, type: 'WRITTEN' })
				return
			}
			if (request.type === 'OPEN_BROKER') {
				const suffix = request.name.slice(binding.broker.baseName.length)
				if (
					new URL(request.url).href !== brokerUrl.href ||
					!request.name.startsWith(binding.broker.baseName) ||
					!/^:generation-\d{1,16}$/.test(suffix) ||
					!Number.isSafeInteger(Number(suffix.slice(':generation-'.length)))
				) {
					reply({ ...correlation, type: 'FAILED', reason: 'rejected' })
					return
				}
				if (workers.size >= MAX_HOST_BROKERS) {
					reply({ ...correlation, type: 'FAILED', reason: 'unavailable' })
					return
				}
				const worker = native.openBroker(brokerUrl.href, request.name)
				workers.add(worker)
				worker.addEventListener('error', lost)
				reply({ ...correlation, type: 'BROKER', port: worker.port }, [worker.port])
				return
			}
			if (request.key !== generationKey) {
				reply({ ...correlation, type: 'FAILED', reason: 'rejected' })
				return
			}
			if (request.type === 'READ_GENERATION') {
				const value = native.storage.getItem(generationKey)
				// Return the raw stored representation. Generation parsing and fallback
				// remain SDK-owned in the application worker.
				const result = { ...correlation, type: 'GENERATION', value } satisfies HostReply
				if (value !== null && value.length > 65_536)
					throw new Error('Generation store exceeds protocol bound')
				reply(result)
				return
			}
			native.storage.setItem(generationKey, request.value)
			reply({ ...correlation, type: 'WRITTEN' })
		} catch {
			reply({ ...correlation, type: 'FAILED', reason: 'unavailable' })
		}
	}
	port.addEventListener('message', receive)
	port.addEventListener('messageerror', lost)
	port.start()
	return close
}
