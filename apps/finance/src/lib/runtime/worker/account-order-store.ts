import { z } from 'zod'
import type { AccountOrderStorage } from '../../contracts/worker-forms.js'

const idsSchema = z.array(z.uuid())
/** One selected native IndexedDB transaction; the owning chart retains its receipt. */
export function createFinanceAccountOrderStorage(namespace: string): AccountOrderStorage {
	function perform(key: string, ids?: readonly string[]): Promise<readonly string[]> {
		const selectedIds = ids === undefined ? undefined : idsSchema.parse(ids)
		return new Promise((resolve, reject) => {
			const request = indexedDB.open('delightful-finance-preferences', 1)
			request.onupgradeneeded = () => request.result.createObjectStore('account-order')
			request.onerror = () => reject(new Error('Account order storage unavailable'))
			request.onsuccess = () => {
				const db = request.result
				db.onversionchange = () => db.close()
				try {
					const transaction = db.transaction('account-order', ids ? 'readwrite' : 'readonly')
					let selected: readonly string[] = []
					transaction.oncomplete = () => {
						db.close()
						resolve(selected)
					}
					transaction.onabort = () => {
						db.close()
						reject(new Error('Account order transaction failed'))
					}
					try {
						const store = transaction.objectStore('account-order'),
							slot = JSON.stringify([namespace, key])
						if (selectedIds) store.put(selectedIds, slot)
						else {
							const read = store.get(slot)
							read.onsuccess = () => {
								const parsed = idsSchema.safeParse(read.result)
								selected = parsed.success ? parsed.data : []
							}
						}
					} catch {
						transaction.abort()
					}
				} catch (error) {
					db.close()
					reject(error)
				}
			}
		})
	}
	return { read: (key) => perform(key), write: (key, ids) => perform(key, ids).then(() => {}) }
}
