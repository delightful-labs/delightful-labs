import type {
	WorkspaceCreationEvidence,
	WorkspaceCreationIdentity,
	WorkspaceCreationJournal,
	WorkspaceCreationJournalKey,
	WorkspaceCreationJournalRead,
	WorkspaceCreationJournalRecord,
	WorkspaceCreationJournalWrite
} from '../../contracts/workspace-creation-journal.js'
import {
	allowsCreationEvidence,
	copyCreationEvidence,
	copyCreationIdentity,
	decodeCreationRecord,
	sameCreationIdentity,
	validCreationEvidence,
	validCreationIdentity,
	validJournalKey
} from './workspace-creation-record.js'

const storeName = 'creationOperations'
const storageFailed = {
	kind: 'unavailable',
	reason: 'storageFailed'
} satisfies WorkspaceCreationJournalWrite
const invalidRecord = {
	kind: 'unavailable',
	reason: 'invalidRecord'
} satisfies WorkspaceCreationJournalWrite
const unsupportedVersion = {
	kind: 'unavailable',
	reason: 'unsupportedVersion'
} satisfies WorkspaceCreationJournalRead

function storageKey(key: WorkspaceCreationJournalKey): IDBValidKey {
	return [key.hostId, key.accountId, key.operationId]
}

/** One IDB persistence leaf; callbacks retain the resource until completion/abort and closure. */
function transaction<Result extends WorkspaceCreationJournalRead | WorkspaceCreationJournalWrite>(
	factory: IDBFactory,
	databaseName: string,
	key: WorkspaceCreationJournalKey,
	mode: 'readonly' | 'readwrite',
	inspect: (cursor: IDBCursorWithValue | null, store: IDBObjectStore) => Result,
	failure: Result,
	versionFailure: Result
): Promise<Result> {
	return new Promise((resolve) => {
		let request: IDBOpenDBRequest
		try {
			request = factory.open(databaseName, 1)
		} catch {
			resolve(failure)
			return
		}
		request.onerror = () =>
			resolve(request.error?.name === 'VersionError' ? versionFailure : failure)
		const abandonOpen = () => {
			request.onsuccess = () => request.result.close()
			try {
				request.transaction?.abort()
			} catch {
				// If upgrade abortion is unavailable, eventual success still closes without any operation.
				request.result.close()
			}
			resolve(failure)
		}
		request.onupgradeneeded = () => {
			try {
				request.result.createObjectStore(storeName)
			} catch {
				abandonOpen()
			}
		}
		request.onblocked = () => {
			// An open request cannot be cancelled. Dispose any eventual late acquisition.
			request.onupgradeneeded = abandonOpen
			abandonOpen()
		}
		request.onsuccess = () => {
			const db = request.result
			db.onversionchange = () => db.close()
			if (db.objectStoreNames.length !== 1 || !db.objectStoreNames.contains(storeName)) {
				db.close()
				resolve(failure)
				return
			}
			let tx: IDBTransaction
			try {
				tx = db.transaction(storeName, mode, mode === 'readwrite' ? { durability: 'strict' } : {})
			} catch {
				db.close()
				resolve(failure)
				return
			}
			let result = failure
			const abort = () => {
				result = failure
				try {
					tx.abort()
				} catch {
					// Completion is unknown; close the connection without claiming cancellation.
					db.close()
					resolve(failure)
				}
			}
			tx.oncomplete = () => {
				db.close()
				resolve(result)
			}
			tx.onabort = () => {
				db.close()
				resolve(failure)
			}
			try {
				const store = tx.objectStore(storeName)
				if (
					store.keyPath !== null ||
					store.autoIncrement ||
					(mode === 'readwrite' && tx.durability !== 'strict')
				) {
					abort()
					return
				}
				const read = store.openCursor(storageKey(key))
				read.onsuccess = () => {
					try {
						result = inspect(read.result, store)
					} catch {
						abort()
					}
				}
			} catch {
				abort()
			}
		}
	})
}

/** Internal browser adapter. Hosts inject their factory/name; importing this module has no effects. */
export function createIndexedDbWorkspaceCreationJournal(
	factory: IDBFactory,
	databaseName: string
): WorkspaceCreationJournal {
	const validName = databaseName.trim().length > 0
	return {
		read(key) {
			if (!validName || !validJournalKey(key)) return Promise.resolve(invalidRecord)
			const fixedKey = {
				hostId: key.hostId,
				accountId: key.accountId,
				operationId: key.operationId
			}
			return transaction<WorkspaceCreationJournalRead>(
				factory,
				databaseName,
				fixedKey,
				'readonly',
				(cursor) => {
					if (!cursor) return { kind: 'missing' }
					const value: unknown = cursor.value
					return decodeCreationRecord(value, fixedKey)
				},
				storageFailed,
				unsupportedVersion
			)
		},
		insertIntent(identity) {
			if (!validName || !validCreationIdentity(identity)) return Promise.resolve(invalidRecord)
			const fixed = copyCreationIdentity(identity)
			return transaction<WorkspaceCreationJournalWrite>(
				factory,
				databaseName,
				fixed,
				'readwrite',
				(cursor, store) => {
					if (cursor) {
						const value: unknown = cursor.value
						const current = decodeCreationRecord(value, fixed)
						if (current.kind === 'unavailable') return current
						return { kind: 'conflict' }
					}
					const record: WorkspaceCreationJournalRecord = {
						version: 1,
						identity: fixed,
						revision: 1,
						evidence: { kind: 'intent' }
					}
					store.add(record, storageKey(fixed))
					return { kind: 'persisted', record }
				},
				storageFailed,
				unsupportedVersion
			)
		},
		advance(
			identity: WorkspaceCreationIdentity,
			expectedRevision: number,
			evidence: WorkspaceCreationEvidence
		) {
			if (
				!validName ||
				!validCreationIdentity(identity) ||
				!Number.isSafeInteger(expectedRevision) ||
				expectedRevision < 1 ||
				expectedRevision >= Number.MAX_SAFE_INTEGER ||
				!validCreationEvidence(evidence)
			)
				return Promise.resolve(invalidRecord)
			const fixed = copyCreationIdentity(identity),
				next = copyCreationEvidence(evidence)
			return transaction<WorkspaceCreationJournalWrite>(
				factory,
				databaseName,
				fixed,
				'readwrite',
				(cursor) => {
					if (!cursor) return { kind: 'conflict' }
					const value: unknown = cursor.value
					const current = decodeCreationRecord(value, fixed)
					if (current.kind === 'unavailable') return current
					if (
						!sameCreationIdentity(current.record.identity, fixed) ||
						current.record.revision !== expectedRevision
					)
						return { kind: 'conflict' }
					if (!allowsCreationEvidence(current.record.evidence, next)) return invalidRecord
					const record: WorkspaceCreationJournalRecord = {
						version: 1,
						identity: fixed,
						revision: expectedRevision + 1,
						evidence: next
					}
					cursor.update(record)
					return { kind: 'persisted', record }
				},
				storageFailed,
				unsupportedVersion
			)
		}
	}
}
