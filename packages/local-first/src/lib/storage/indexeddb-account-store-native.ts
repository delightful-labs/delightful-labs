import {
	MAX_INDEXEDDB_ACCOUNT_VALUE_LENGTH,
	type IndexedDbAccountCall,
	type IndexedDbAccountNative,
	type IndexedDbAccountNativeEvent,
	type IndexedDbAccountResult
} from '../contracts/indexeddb-account-store.js'

const storeName = 'selections'
type Slot = { transaction: IDBTransaction | undefined }
/** Native handles and receipts only. The owning chart selects admission and close.
 * A slot is registered before native transaction creation, including reentrancy. */
export function createIndexedDbAccountNative(input: {
	databaseName: string
	key: string
	factory: IDBFactory | undefined
}): IndexedDbAccountNative {
	let resolveClose: (() => void) | undefined
	let rejectClose: ((error: Error) => void) | undefined
	const closed = new Promise<void>((resolve, reject) => {
		resolveClose = resolve
		rejectClose = reject
	})
	void closed.catch(() => {})
	const slots = new Set<Slot>()
	let database: IDBDatabase | undefined
	let opening: { request: IDBOpenDBRequest | undefined } | undefined
	let report: ((event: IndexedDbAccountNativeEvent) => void) | undefined
	let admitted = true

	function finishClose() {
		if (!admitted && !database && !opening && slots.size === 0) resolveClose?.()
	}
	function close() {
		admitted = false
		try {
			database?.close()
			database = undefined
			finishClose()
		} catch {
			rejectClose?.(new Error('Account database close failed'))
		}
	}
	function emit(event: IndexedDbAccountNativeEvent) {
		try {
			report?.(event)
		} catch {
			close()
		}
	}
	function open() {
		if (!admitted || opening || database) return
		const acquisition: { request: IDBOpenDBRequest | undefined } = { request: undefined }
		opening = acquisition
		try {
			if (!input.factory) throw new Error('IndexedDB unavailable')
			const request = input.factory.open(input.databaseName, 1)
			acquisition.request = request
			request.onupgradeneeded = () => {
				try {
					if (!admitted) request.transaction?.abort()
					else request.result.createObjectStore(storeName)
				} catch {
					try {
						request.transaction?.abort()
					} catch {
						/* Keep observing the original open request's terminal event. */
					}
					emit({ type: 'OPEN_FAILED' })
				}
			}
			request.onblocked = () => emit({ type: 'OPEN_FAILED' })
			request.onerror = () => {
				opening = undefined
				emit({ type: 'OPEN_FAILED' })
				finishClose()
			}
			request.onsuccess = () => {
				opening = undefined
				const acquired = request.result
				database = acquired
				if (!admitted) {
					close()
					return
				}
				if (!acquired.objectStoreNames.contains(storeName)) {
					emit({ type: 'OPEN_FAILED' })
					close()
					return
				}
				acquired.onversionchange = () => {
					close()
					emit({ type: 'INVALIDATED' })
				}
				acquired.onclose = () => {
					if (database === acquired) database = undefined
					admitted = false
					emit({ type: 'INVALIDATED' })
					finishClose()
				}
				emit({ type: 'OPENED' })
			}
		} catch {
			opening = undefined
			emit({ type: 'OPEN_FAILED' })
			finishClose()
		}
	}
	function perform(call: IndexedDbAccountCall) {
		const id = call.id
		const acquired = database
		if (!admitted || !acquired) {
			emit({
				type: 'SETTLED',
				id,
				result: { kind: 'failed', reason: 'closed', outcome: 'not-issued' }
			})
			return
		}
		const slot: Slot = { transaction: undefined }
		slots.add(slot)
		let transaction: IDBTransaction
		try {
			transaction = acquired.transaction(
				storeName,
				call.operation.kind === 'read' ? 'readonly' : 'readwrite',
				{ durability: 'strict' }
			)
		} catch {
			slots.delete(slot)
			emit({
				type: 'SETTLED',
				id,
				result: { kind: 'failed', reason: 'unavailable', outcome: 'not-issued' }
			})
			finishClose()
			return
		}
		slot.transaction = transaction
		let selected: IndexedDbAccountResult | undefined
		let failure: 'unavailable' | 'invalid-value' | 'closed' | undefined
		let request: IDBRequest<IDBCursorWithValue | null> | undefined
		let operation: IndexedDbAccountCall['operation'] | undefined = call.operation
		const settle = (result: IndexedDbAccountResult) => {
			if (!slots.delete(slot)) return
			transaction.oncomplete = null
			transaction.onabort = null
			transaction.onerror = null
			if (request) request.onsuccess = null
			operation = undefined
			slot.transaction = undefined
			emit({ type: 'SETTLED', id, result })
			finishClose()
		}
		const abort = () => {
			try {
				transaction.abort()
			} catch {
				/* Abort refusal is not settlement; retain complete/abort handlers. */
			}
		}
		transaction.oncomplete = () =>
			settle(
				failure || !selected
					? { kind: 'failed', reason: failure ?? 'unavailable', outcome: 'unknown' }
					: selected
			)
		transaction.onabort = () =>
			settle({ kind: 'failed', reason: failure ?? 'unavailable', outcome: 'aborted' })
		transaction.onerror = () => {
			failure ??= 'unavailable'
			abort()
		}
		try {
			if (call.operation.kind === 'update' && transaction.durability !== 'strict') {
				failure = 'unavailable'
				abort()
				return
			}
			if (!admitted) {
				failure = 'closed'
				abort()
				return
			}
			// A cursor distinguishes an absent record from a corrupt stored undefined.
			request = transaction.objectStore(storeName).openCursor(input.key)
			request.onsuccess = () => {
				try {
					const cursor = request?.result
					let current: string | null = null
					if (cursor) {
						const raw: unknown = cursor.value
						if (typeof raw !== 'string' || raw.length > MAX_INDEXEDDB_ACCOUNT_VALUE_LENGTH) {
							failure = 'invalid-value'
							abort()
							return
						}
						current = raw
					}
					if (!admitted) {
						failure = 'closed'
						abort()
						return
					}
					if (operation?.kind === 'read') selected = { kind: 'read', value: current }
					else if (operation?.kind === 'update') {
						// One atomic SDK operation: no await/message round trip may split it.
						const replacement = operation.transform(current)
						if (
							typeof replacement !== 'string' ||
							replacement.length > MAX_INDEXEDDB_ACCOUNT_VALUE_LENGTH
						) {
							failure = 'invalid-value'
							abort()
							return
						}
						if (!admitted) {
							failure = 'closed'
							abort()
							return
						}
						transaction.objectStore(storeName).put(replacement, input.key)
						selected = { kind: 'updated' }
					}
				} catch {
					failure = 'unavailable'
					abort()
				} finally {
					operation = undefined
				}
			}
		} catch {
			failure = 'unavailable'
			abort()
		}
	}
	return {
		closed,
		listen(observer) {
			report = observer
			return () => {
				report = undefined
				close()
			}
		},
		open,
		perform,
		close
	}
}
