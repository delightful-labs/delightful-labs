import { createIndexedDbWorkspaceCreationJournal } from '../../src/lib/backend/browser/workspace-creation-journal.js'

/** Native IDB setup helpers for corrupt-record/failure fixtures; never used by the adapter. */
function open(
	name: string,
	version = 1,
	layout: 'normal' | 'extraStore' | 'keyPath' = 'normal'
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, version)
		request.onupgradeneeded = () => {
			const db = request.result
			if (!db.objectStoreNames.contains('creationOperations'))
				db.createObjectStore('creationOperations', layout === 'keyPath' ? { keyPath: 'id' } : {})
			if (layout === 'extraStore') db.createObjectStore('unrelated')
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
		request.onblocked = () => reject(new Error('Fixture setup open blocked'))
	})
}
async function rawPut(name: string, key: IDBValidKey, value: unknown) {
	const db = await open(name)
	return new Promise<void>((resolve, reject) => {
		const tx = db.transaction('creationOperations', 'readwrite', { durability: 'strict' })
		tx.oncomplete = () => {
			db.close()
			resolve()
		}
		tx.onabort = () => {
			db.close()
			reject(tx.error)
		}
		tx.objectStore('creationOperations').put(value, key)
	})
}
async function rawGet(name: string, key: IDBValidKey) {
	const db = await open(name)
	return new Promise<unknown>((resolve, reject) => {
		let value: unknown
		const tx = db.transaction('creationOperations', 'readonly')
		tx.oncomplete = () => {
			db.close()
			resolve(value)
		}
		tx.onabort = () => {
			db.close()
			reject(tx.error)
		}
		const request = tx.objectStore('creationOperations').get(key)
		request.onsuccess = () => {
			value = request.result
		}
	})
}
const controls = {
	create(name: string, factory = indexedDB) {
		return createIndexedDbWorkspaceCreationJournal(factory, name)
	},
	factory(open: IDBFactory['open']): IDBFactory {
		return {
			open,
			cmp: indexedDB.cmp.bind(indexedDB),
			databases: indexedDB.databases.bind(indexedDB),
			deleteDatabase: indexedDB.deleteDatabase.bind(indexedDB)
		}
	},
	open,
	rawPut,
	rawGet
}
declare global {
	interface Window {
		journalFixture: typeof controls
	}
}
window.journalFixture = controls
