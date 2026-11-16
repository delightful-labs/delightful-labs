import {
	createFinanceAccountStore,
	type FinanceAccountStoreConfiguration
} from '../../src/lib/runtime/worker/account-store.js'

export type Operation =
	| { type: 'STORE_OPEN'; slot: string; configuration: FinanceAccountStoreConfiguration }
	| { type: 'STORE_READ'; slot: string }
	| { type: 'STORE_CLOSE'; slot: string }
	| { type: 'STORE_APPEND'; slot: string; value: string }
export type Reply =
	| { type: 'READY' }
	| { type: 'RESULT'; id: number; value: unknown }
	| { type: 'ERROR'; id: number; outcome: string; reason: string }

const stores = new Map<string, ReturnType<typeof createFinanceAccountStore>>()
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
