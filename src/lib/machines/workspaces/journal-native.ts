import { fromCallback } from 'xstate'

export type JournalDatabaseEvent =
	| { type: 'OPENED' | 'CLOSED' }
	| { type: 'ACQUIRED'; tx: IDBTransaction }
	| { type: 'OPEN_FAILED' | 'ACQUIRE_FAILED' | 'CLOSE_FAILED'; error: unknown }
type Command = { type: 'OPEN' | 'ACQUIRE' | 'CLOSE' }

/** Native handles span the running journal scope; decisions and transaction policy stay in its chart. */
export const journalDatabase = fromCallback<Command, { databaseName: string }>(
	({ input, receive, sendBack }) => {
		let database: IDBDatabase | undefined
		let transaction: IDBTransaction | undefined
		let report: ((event: JournalDatabaseEvent) => void) | undefined = sendBack
		receive((command) => {
			try {
				if (command.type === 'OPEN') {
					const request = indexedDB.open(input.databaseName, 1)
					request.onupgradeneeded = () => {
						try {
							if (report === undefined) {
								request.transaction?.abort()
								return
							}
							request.result.createObjectStore('attempts', { keyPath: 'key' })
						} catch (error) {
							report?.({ type: 'OPEN_FAILED', error })
							try {
								request.transaction?.abort()
							} catch {
								/* Upgrade may already be terminal. */
							}
						}
					}
					request.onsuccess = () => {
						const opened = request.result
						if (report === undefined) {
							opened.close()
							return
						}
						database = opened
						report({ type: 'OPENED' })
					}
					request.onerror = () => report?.({ type: 'OPEN_FAILED', error: request.error })
					return
				}
				if (command.type === 'ACQUIRE') {
					if (database === undefined) throw new Error('Missing journal database')
					transaction = database.transaction('attempts', 'readwrite')
					report?.({ type: 'ACQUIRED', tx: transaction })
					return
				}
				database?.close()
				database = undefined
				transaction = undefined
				report?.({ type: 'CLOSED' })
			} catch (error) {
				report?.({
					type:
						command.type === 'OPEN'
							? 'OPEN_FAILED'
							: command.type === 'ACQUIRE'
								? 'ACQUIRE_FAILED'
								: 'CLOSE_FAILED',
					error
				})
			}
		})
		return () => {
			report = undefined
			try {
				transaction?.abort()
			} catch {
				/* Abort cannot undo a committing or finished transaction. */
			}
			transaction = undefined
			database?.close()
			database = undefined
		}
	}
)
