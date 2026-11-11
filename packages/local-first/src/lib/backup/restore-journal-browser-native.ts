import { createCallbackLogic } from 'xstate'
import {
	browserJournalData,
	browserJournalFailure,
	clearBrowserJournalBuffers,
	type BrowserJournalErrorCode,
	type BrowserJournalRequest
} from './restore-journal-browser.js'

export type BrowserJournalNativeCommand = {
	type:
		| 'OPEN'
		| 'CREATE_SCHEMA'
		| 'REJECT_UPGRADE'
		| 'BEGIN'
		| 'READ'
		| 'WRITE'
		| 'COMMIT'
		| 'ABORT'
		| 'CLOSE'
}
export type BrowserJournalNativeEvent =
	| { type: 'UPGRADE_REQUESTED'; oldVersion: number; newVersion: number | null }
	| { type: 'UPGRADE_APPLIED' }
	| { type: 'OPENED'; supported: boolean }
	| { type: 'OPEN_FAILED'; code?: BrowserJournalErrorCode }
	| { type: 'BEGIN_FAILED'; code: BrowserJournalErrorCode }
	| { type: 'TX_STARTED'; strict: boolean; supported: boolean }
	| { type: 'READ_READY'; exists: boolean }
	| { type: 'WRITE_QUEUED' | 'STAGED' | 'TX_COMPLETE' | 'TX_ABORTED' | 'CLOSED' | 'RELEASE' }
	| {
			type: 'NATIVE_FAILED'
			code: BrowserJournalErrorCode
			operation: BrowserJournalNativeCommand['type']
	  }
const storeName = 'restoreOperations'
/** Native calls and event translation only; admission, sequencing, settlement and cleanup policy are states. */
export const browserJournalNativeActor = createCallbackLogic<
	BrowserJournalNativeCommand,
	{ request: BrowserJournalRequest }
>(({ input, receive, sendBack }) => {
	const data = browserJournalData(input.request)
	const configuration = data.configuration
	let upgrade: IDBOpenDBRequest | undefined
	let database: IDBDatabase | undefined
	let transaction: IDBTransaction | undefined
	let report: ((event: BrowserJournalNativeEvent) => void) | undefined = sendBack
	const release = () => report?.({ type: 'RELEASE' })
	data.releaseControl = release
	function abort() {
		try {
			transaction?.abort()
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'InvalidStateError'))
				report?.({ type: 'NATIVE_FAILED', code: browserJournalFailure(error), operation: 'ABORT' })
		}
	}
	receive((command) => {
		try {
			if (command.type === 'REJECT_UPGRADE') {
				upgrade?.transaction?.abort()
				upgrade = undefined
				return
			}
			if (command.type === 'CREATE_SCHEMA') {
				const pending = upgrade
				if (!pending) throw new Error('Missing active journal upgrade')
				// The chart grants schema creation; recheck native request custody beside the mutation.
				if (!report || data.configuration !== configuration) {
					pending.transaction?.abort()
					upgrade = undefined
					return
				}
				pending.result.createObjectStore(storeName)
				upgrade = undefined
				report({ type: 'UPGRADE_APPLIED' })
				return
			}
			if (command.type === 'CLOSE') {
				database?.close()
				database = undefined
				transaction = undefined
				report?.({ type: 'CLOSED' })
				return
			}
			if (command.type === 'ABORT') {
				abort()
				return
			}
			if (command.type === 'OPEN') {
				if (!configuration || typeof indexedDB === 'undefined') {
					report?.({ type: 'OPEN_FAILED', ...(!configuration ? { code: 'journalReleased' } : {}) })
					return
				}
				const request = indexedDB.open(configuration.databaseName, 1)
				request.onupgradeneeded = (event) => {
					upgrade = request
					try {
						report?.({
							type: 'UPGRADE_REQUESTED',
							oldVersion: event.oldVersion,
							newVersion: event.newVersion
						})
					} catch (error) {
						report?.({
							type: 'NATIVE_FAILED',
							operation: 'OPEN',
							code: browserJournalFailure(error)
						})
					} finally {
						// A command must decide synchronously while this versionchange transaction is active.
						// Never let delayed delivery, missing ownership or actor stop implicitly accept it.
						try {
							upgrade?.transaction?.abort()
						} catch {
							/* await native open settlement */
						}
						upgrade = undefined
					}
				}
				request.onerror = (event) => {
					event.preventDefault()
					report?.({ type: 'OPEN_FAILED' })
				}
				request.onsuccess = () => {
					const acquired = request.result
					if (!report) {
						acquired.close()
						return
					}
					database = acquired
					database.onversionchange = () =>
						report?.({ type: 'NATIVE_FAILED', operation: 'OPEN', code: 'journalStoreFailed' })
					report({
						type: 'OPENED',
						supported:
							acquired.objectStoreNames.length === 1 &&
							acquired.objectStoreNames.contains(storeName)
					})
				}
				return
			}
			if (command.type === 'BEGIN') {
				if (!database) throw new Error('Missing database')
				const tx = database.transaction(storeName, 'readwrite', { durability: 'strict' })
				transaction = tx
				tx.oncomplete = () => report?.({ type: 'TX_COMPLETE' })
				tx.onabort = () => {
					if (tx.error)
						report?.({ type: 'NATIVE_FAILED', operation: 'ABORT', code: 'journalStoreFailed' })
					report?.({ type: 'TX_ABORTED' })
				}
				tx.onerror = (event) => {
					const error = event.target instanceof IDBRequest ? event.target.error : undefined
					if (error?.name === 'AbortError' && tx.error === null) return
					report?.({ type: 'NATIVE_FAILED', operation: 'ABORT', code: 'journalStoreFailed' })
				}
				const store = tx.objectStore(storeName)
				report?.({
					type: 'TX_STARTED',
					strict: tx.durability === 'strict',
					supported: store.keyPath === null && !store.autoIncrement && store.indexNames.length === 0
				})
				return
			}
			if (!transaction || !configuration) throw new Error('Missing transaction')
			if (command.type === 'COMMIT') {
				transaction.commit()
				return
			}
			const store = transaction.objectStore(storeName)
			const scope = configuration.binding
			const key = JSON.stringify([
				scope.applicationId,
				scope.environment,
				scope.identityId,
				scope.operationId
			])
			if (command.type === 'READ') {
				const request = store.openCursor(key)
				request.onsuccess = () => {
					const raw: unknown = request.result?.value
					if (!report || !data.configuration) {
						if (raw instanceof Uint8Array) raw.fill(0)
					} else data.raw = raw
					report?.({ type: 'READ_READY', exists: request.result !== null })
				}
				return
			}
			if (!data.encoded) throw new Error('Missing encoded journal')
			const request =
				configuration.command.mode === 'create'
					? store.add(data.encoded, key)
					: store.put(data.encoded, key)
			report?.({ type: 'WRITE_QUEUED' })
			request.onsuccess = () => report?.({ type: 'STAGED' })
		} catch (error) {
			if (command.type === 'OPEN')
				report?.({ type: 'OPEN_FAILED', code: browserJournalFailure(error) })
			else if (command.type === 'BEGIN' && !transaction)
				report?.({ type: 'BEGIN_FAILED', code: browserJournalFailure(error) })
			else
				report?.({
					type: 'NATIVE_FAILED',
					operation: command.type,
					code: command.type === 'CLOSE' ? 'journalCleanupFailed' : browserJournalFailure(error)
				})
		}
	})
	return () => {
		// Callback teardown releases native handles even after abrupt parent stop. A late open
		// observes the detached reporter above and closes its connection instead of delivering it.
		report = undefined
		try {
			upgrade?.transaction?.abort()
		} catch {
			/* native upgrade may already be terminal */
		}
		upgrade = undefined
		if (data.releaseControl === release) data.releaseControl = undefined
		abort()
		try {
			database?.close()
		} catch {
			/* disposal cannot acknowledge failed cleanup */
		}
		clearBrowserJournalBuffers(input.request)
	}
})
