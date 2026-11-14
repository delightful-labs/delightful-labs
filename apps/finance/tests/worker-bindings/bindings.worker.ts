import {
	createFinanceAccountStore,
	type FinanceAccountStoreConfiguration
} from '../../src/lib/runtime/worker/account-store.js'
import { brokerHostClient } from 'delightful-local-first/backend/jazz/worker-broker'
import { createOwnedBrokerFixture } from './owned-broker.js'

export type Operation =
	| { type: 'STORE_OPEN'; slot: string; configuration: FinanceAccountStoreConfiguration }
	| { type: 'STORE_READ'; slot: string }
	| { type: 'STORE_CLOSE'; slot: string }
	| { type: 'STORE_APPEND'; slot: string; value: string }
	| {
			type: 'BROKER_INIT'
			data: MessagePort
			control: MessagePort
			scope: string
			ownership: 'root' | 'child'
	  }
	| { type: 'BROKER_READ'; key: string }
	| { type: 'BROKER_WRITE'; key: string; value: string }
	| { type: 'BROKER_OPEN'; url: string; name: string }
	| { type: 'BROKER_ECHO'; value: string }
	| { type: 'BROKER_CLOSE' }
export type Reply =
	| { type: 'READY' }
	| { type: 'RESULT'; id: number; value: unknown }
	| { type: 'ERROR'; id: number; outcome: string; reason: string }

const stores = new Map<string, ReturnType<typeof createFinanceAccountStore>>()
let broker: ReturnType<typeof brokerHostClient> | undefined
let accepted: MessagePort | undefined
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Fixture resource missing')
	return value
}
async function execute(operation: Operation): Promise<unknown> {
	if (operation.type === 'STORE_OPEN') {
		if (stores.has(operation.slot)) throw new Error('Fixture store already open')
		stores.set(operation.slot, createFinanceAccountStore(operation.configuration))
		return null
	}
	if (operation.type === 'STORE_READ') return required(stores.get(operation.slot)).read()
	if (operation.type === 'STORE_CLOSE') {
		await required(stores.get(operation.slot)).close()
		return null
	}
	if (operation.type === 'STORE_APPEND') {
		await required(stores.get(operation.slot)).update(
			(current) => (current ?? '') + operation.value
		)
		return null
	}
	if (operation.type === 'BROKER_INIT') {
		if (broker) throw new Error('Fixture broker already open')
		broker =
			operation.ownership === 'child'
				? createOwnedBrokerFixture(operation.data, operation.control, operation.scope)
				: brokerHostClient(operation.data, operation.control, operation.scope, {
						onOverdue: () => {},
						onBlocked: () => {}
					})
		return broker.host.identity
	}
	if (operation.type === 'BROKER_READ') return required(broker).readGeneration(operation.key)
	if (operation.type === 'BROKER_WRITE') {
		await required(broker).writeGeneration(operation.key, operation.value)
		return null
	}
	if (operation.type === 'BROKER_OPEN') {
		accepted = (await required(broker).open(operation.url, operation.name)).port
		return null
	}
	if (operation.type === 'BROKER_CLOSE') return required(broker).close()
	const port = required(accepted)
	return new Promise<unknown>((resolve) => {
		port.onmessage = ({ data }) => resolve(data)
		port.postMessage(operation.value)
	})
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; operation: Operation }>) => {
	try {
		const value = await execute(data.operation)
		self.postMessage({ type: 'RESULT', id: data.id, value } satisfies Reply)
	} catch (error) {
		const facts = error instanceof Error ? error : undefined
		const outcome =
			facts && 'workerEffectOutcome' in facts
				? facts.workerEffectOutcome
				: facts && 'writeOutcome' in facts
					? facts.writeOutcome
					: 'unknown'
		const reason = facts && 'reason' in facts ? facts.reason : 'unavailable'
		self.postMessage({
			type: 'ERROR',
			id: data.id,
			outcome: typeof outcome === 'string' ? outcome : 'unknown',
			reason: typeof reason === 'string' ? reason : 'unavailable'
		} satisfies Reply)
	}
}
self.postMessage({ type: 'READY' } satisfies Reply)
