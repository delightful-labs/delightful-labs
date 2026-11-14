import { createActor } from 'xstate'
import type { AccountStore } from 'jazz-tools'
import type {
	IndexedDbAccountOperation,
	IndexedDbAccountResult
} from '../../contracts/indexeddb-account-store.js'
import { indexedDbAccountStoreMachine } from '../../machines/identity/indexeddb-account-store.js'
import { createIndexedDbAccountNative } from '../../storage/indexeddb-account-store-native.js'

export type IndexedDbAccountStoreOptions = {
	databaseName: string
	key: string
	factory?: IDBFactory
}
function failure(result: Extract<IndexedDbAccountResult, { kind: 'failed' }>) {
	return Object.assign(new Error('Account storage unavailable'), {
		reason: result.reason,
		writeOutcome: result.outcome
	})
}
/** Explicit SDK/native root. Starts no SDK, accesses no localStorage, and
 * never imports/migrates a legacy selection. Keep one stable store per binding. */
export function createIndexedDbAccountStore(
	options: IndexedDbAccountStoreOptions
): AccountStore & { close: () => Promise<void> } {
	if (
		typeof options.databaseName !== 'string' ||
		!options.databaseName ||
		options.databaseName.length > 1024 ||
		typeof options.key !== 'string' ||
		!options.key ||
		options.key.length > 65_536
	)
		throw new Error('Invalid account storage binding')
	const native = createIndexedDbAccountNative({
		databaseName: options.databaseName,
		key: options.key,
		factory: options.factory ?? globalThis.indexedDB
	})
	const pending = new Map<number, (result: IndexedDbAccountResult) => void>()
	let sequence = 0
	const owner = createActor(indexedDbAccountStoreMachine, { input: { native } })
	const failPending = () => {
		for (const respond of pending.values())
			respond({ kind: 'failed', reason: 'unavailable', outcome: 'unknown' })
	}
	owner.subscribe({
		complete: failPending,
		error: () => {
			native.close()
			failPending()
		}
	})
	owner.start()
	function request(operation: IndexedDbAccountOperation) {
		return new Promise<IndexedDbAccountResult>((resolve) => {
			if (owner.getSnapshot().status !== 'active' || sequence >= Number.MAX_SAFE_INTEGER) {
				resolve({ kind: 'failed', reason: 'closed', outcome: 'not-issued' })
				return
			}
			const id = ++sequence
			const respond = (result: IndexedDbAccountResult) => {
				if (!pending.delete(id)) return
				resolve(result)
			}
			pending.set(id, respond)
			owner.send({ type: 'CALL', call: { id, operation, respond } })
		})
	}
	return {
		async read() {
			const result = await request({ kind: 'read' })
			if (result.kind === 'failed') throw failure(result)
			if (result.kind !== 'read') throw new Error('Invalid account storage result')
			return result.value
		},
		async update(transform) {
			const result = await request({ kind: 'update', transform })
			if (result.kind === 'failed') throw failure(result)
			if (result.kind !== 'updated') throw new Error('Invalid account storage result')
		},
		close() {
			if (owner.getSnapshot().status === 'active') owner.send({ type: 'CLOSE' })
			return native.closed
		}
	}
}
