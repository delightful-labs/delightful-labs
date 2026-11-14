import { serveBrokerHost } from 'delightful-local-first/backend/jazz/worker-broker'
import { financeBrokerGrantBinding, financeGenerationGrantBinding } from './grant-binding.js'
import type { FinanceBrokerGrant, FinanceGenerationGrant } from './grant-binding.js'

export type { FinanceBrokerGrant, FinanceGenerationGrant } from './grant-binding.js'
export type FinanceBrokerNative = {
	origin: string
	storage: Pick<Storage, 'getItem' | 'setItem'>
	openBroker: (
		url: string,
		name: string
	) => Pick<SharedWorker, 'port' | 'addEventListener' | 'removeEventListener'>
}

/** Exact-key grant for existing SDK readGeneration/writeGeneration callbacks.
 * It holds no SharedWorker constructor and cannot admit broker opens. */
export function serveFinanceGenerationGrant(
	data: MessagePort,
	control: MessagePort,
	grant: FinanceGenerationGrant,
	native: Pick<FinanceBrokerNative, 'storage'>
) {
	const selected = financeGenerationGrantBinding(grant)
	return serveBrokerHost(data, control, selected.scope, {
		storage: native.storage,
		admitGeneration: (key) => key === selected.key,
		admitOpen: () => false,
		open: () => {
			throw new Error('Finance generation grant cannot open a broker')
		}
	})
}

/** Exact URL/name grant for the existing SDK open callback. Each generation
 * uses the SDK-supplied name; no private namespace derivation or storage access. */
export function serveFinanceBrokerGrant(
	data: MessagePort,
	control: MessagePort,
	grant: FinanceBrokerGrant,
	native: Pick<FinanceBrokerNative, 'origin' | 'openBroker'>
) {
	const selected = financeBrokerGrantBinding(grant, native.origin)
	return serveBrokerHost(data, control, selected.scope, {
		open: (_url, name) => native.openBroker(selected.url, name),
		admitOpen: (url, name) => new URL(url).href === selected.url && name === selected.name,
		admitGeneration: () => false,
		storage: {
			getItem: () => {
				throw new Error('Finance broker grant cannot read generation storage')
			},
			setItem: () => {
				throw new Error('Finance broker grant cannot write generation storage')
			}
		}
	})
}
