import { serveBrokerHost as serveSharedBrokerHost } from 'delightful-local-first/backend/jazz/worker-broker'

export { brokerHostClient } from 'delightful-local-first/backend/jazz/worker-broker'
export type { BrokerHostOptions } from 'delightful-local-first/backend/jazz/worker-broker'

export type BrokerHostNative = {
	origin: string
	storage: Pick<Storage, 'getItem' | 'setItem'>
	open: (
		url: string,
		name: string
	) => Pick<SharedWorker, 'port' | 'addEventListener' | 'removeEventListener'>
}
/** Clipper owns its existing capability admission; Local First owns the native
 * broker transport, request lifetime and independent close control. */
export function serveBrokerHost(
	dataPort: MessagePort,
	controlPort: MessagePort,
	scope: string,
	native: BrokerHostNative
) {
	return serveSharedBrokerHost(dataPort, controlPort, scope, {
		storage: native.storage,
		open: (url, name) => native.open(url, name),
		admitOpen: (url) => new URL(url).origin === native.origin,
		admitGeneration: (key) => key.startsWith('jazz:shared-worker-generation:jazz-runtime:')
	})
}
