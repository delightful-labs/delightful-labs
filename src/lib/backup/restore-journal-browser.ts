import { z } from 'zod'
import { backupBindingSchema, type BackupBinding } from './export.js'
import { wellFormed } from './schemas.js'
import {
	createRestoreJournalRecord,
	decodeRestoreJournalRecord,
	encodeRestoreJournalRecord,
	parseRestoreJournalRecord,
	RestoreJournalError,
	type RestoreJournalErrorCode,
	type RestoreJournalIntent,
	type RestoreJournalRecord
} from './restore-journal.js'
import { isValidatedRestoreJournalSuccessor } from './restore-journal-successor.js'

export type BrowserJournalCommand =
	| { mode: 'initialize' }
	| { mode: 'load'; intent: RestoreJournalIntent }
	| { mode: 'create'; record: RestoreJournalRecord }
	| { mode: 'update'; expectedRevision: number; record: RestoreJournalRecord }
export type BrowserJournalInterruption = 'cancelled' | 'closed' | 'invalidated'
export type BrowserJournalErrorCode =
	| RestoreJournalErrorCode
	| 'invalidJournalRequest'
	| 'journalInUse'
	| 'journalReleased'
	| 'journalStoreFailed'
	| 'journalCleanupFailed'
export class BrowserJournalError extends Error {
	constructor(readonly code: BrowserJournalErrorCode) {
		super(code)
		this.name = 'BrowserJournalError'
	}
}
export interface BrowserJournalRecordView {
	/** Borrowed immutable recovery metadata, valid only until its request is released. No authority. */
	readRecord(): RestoreJournalRecord
	toJSON(): { kind: 'browserJournalRecord' }
}
export interface BrowserJournalRequest {
	/** Abrupt fallback: abort admission/work where possible and retain late resources for cleanup.
	 * Gracefully CANCEL/SHUTDOWN and await actor completion before stopping whenever possible.
	 * Also invalidates the borrowed result view after completion.
	 */
	release(): void
	toJSON(): { kind: 'browserJournalRequest' }
}
type Success =
	| 'initialized'
	| 'loaded'
	| 'created'
	| 'updated'
	| 'existing'
	| 'conflict'
	| 'missing'
	| 'unavailable'
export type BrowserJournalResult = {
	binding: BackupBinding
	journal: {
		settlement: 'notStarted' | 'committed' | 'aborted' | 'unknown'
		durability: 'strict' | null
	}
	record?: BrowserJournalRecordView
} & (
	| { outcome: Success | BrowserJournalInterruption }
	| { outcome: 'failed'; code: BrowserJournalErrorCode }
)
export type BrowserJournalNativeEvent = {
	type: 'READ_READY' | 'STAGED' | 'TX_COMPLETE' | 'TX_ABORTED' | 'TX_FAILED'
}
export type BrowserJournalNativeCommand = { type: 'READ' | 'WRITE' | 'COMMIT' | 'ABORT' }
export type BrowserJournalDecision = 'write' | 'observe' | 'abort'
const storeName = 'restoreOperations'
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new BrowserJournalError('journalReleased')
	return value
}
export function browserJournalFailure(error: unknown): BrowserJournalErrorCode {
	return error instanceof BrowserJournalError || error instanceof RestoreJournalError
		? error.code
		: 'journalStoreFailed'
}
function matchesBinding(record: RestoreJournalRecord, binding: BackupBinding): boolean {
	const scope = record.intent.operation
	return (
		scope.applicationId === binding.applicationId &&
		scope.environment === binding.environment &&
		scope.identityId === binding.identityId &&
		scope.operationId === binding.operationId &&
		scope.destinationWorkspaceId === binding.workspaceId
	)
}
function sameRecord(left: RestoreJournalRecord, right: RestoreJournalRecord): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}
class RecordView implements BrowserJournalRecordView {
	#record: RestoreJournalRecord | undefined
	constructor(record: RestoreJournalRecord) {
		this.#record = record
		Object.freeze(this)
	}
	readRecord() {
		return required(this.#record)
	}
	clear() {
		this.#record = undefined
	}
	toJSON(): { kind: 'browserJournalRecord' } {
		return { kind: 'browserJournalRecord' }
	}
}

/** Private native resource boundary; policy sequencing belongs to the owning statechart. */
class BrowserJournalOperation {
	readonly binding: BackupBinding
	readonly mode: BrowserJournalCommand['mode']
	#databaseName: string
	#key: string
	#command: BrowserJournalCommand | undefined
	#controller = new AbortController()
	#claimed = false
	#released = false
	#pending = 0
	#idle = new Set<() => void>()
	#database: IDBDatabase | undefined
	#tx: IDBTransaction | undefined
	#terminal: 'complete' | 'abort' | undefined
	#strict = false
	#schema = false
	#observer: ((event: BrowserJournalNativeEvent) => void) | undefined
	#raw: unknown
	#exists = false
	#observed: RestoreJournalRecord | undefined
	#view: RecordView | undefined
	#stagedBytes: Uint8Array<ArrayBuffer> | undefined
	#writeQueued = false
	#staged = false
	#outcome: Success = 'unavailable'
	#failure: BrowserJournalErrorCode | undefined
	constructor(databaseName: string, binding: BackupBinding, command: BrowserJournalCommand) {
		this.#databaseName = databaseName
		this.binding = binding
		this.mode = command.mode
		this.#command = command
		this.#key = JSON.stringify([
			binding.applicationId,
			binding.environment,
			binding.identityId,
			binding.operationId
		])
	}
	claim() {
		if (this.#released) throw new BrowserJournalError('journalReleased')
		if (this.#claimed) throw new BrowserJournalError('journalInUse')
		this.#claimed = true
	}
	#eligible() {
		if (this.#released || this.#controller.signal.aborted)
			throw new BrowserJournalError('journalReleased')
	}
	#track<T>(promise: Promise<T>): Promise<T> {
		this.#pending += 1
		return promise.finally(() => this.#settled())
	}
	#settled() {
		this.#pending -= 1
		if (this.#pending === 0) {
			for (const done of this.#idle) done()
			this.#idle.clear()
		}
		if (this.#released) this.#fallbackCleanup()
	}
	#fail(error: unknown) {
		const code = browserJournalFailure(error)
		if (!this.#failure || code === 'journalCleanupFailed') this.#failure = code
	}
	openDatabase(): Promise<'opened' | 'unavailable'> {
		this.#eligible()
		if (typeof indexedDB === 'undefined') return Promise.resolve('unavailable')
		const promise = new Promise<'opened' | 'unavailable'>((resolve) => {
			const request = indexedDB.open(this.#databaseName, 1)
			request.onupgradeneeded = (event) => {
				try {
					if (
						this.mode !== 'initialize' ||
						event.oldVersion !== 0 ||
						this.#released ||
						this.#controller.signal.aborted
					) {
						request.transaction?.abort()
						return
					}
					request.result.createObjectStore(storeName)
				} catch (error) {
					this.#fail(error)
					try {
						request.transaction?.abort()
					} catch {
						/* await the native open outcome */
					}
				}
			}
			request.onerror = (event) => {
				event.preventDefault()
				resolve('unavailable')
			}
			request.onsuccess = () => {
				this.#database = request.result // retain before completion, including late acquisition
				this.#database.onversionchange = () => {
					this.#fail(new BrowserJournalError('journalStoreFailed'))
					this.abort()
				}
				if (
					request.result.objectStoreNames.length !== 1 ||
					!request.result.objectStoreNames.contains(storeName)
				) {
					resolve('unavailable')
					return
				}
				if (this.mode === 'initialize') this.#outcome = 'initialized'
				resolve('opened')
			}
			// Open cannot generally be cancelled. Blocked requests remain owned until a native outcome;
			// abrupt request release still closes an eventual late connection.
			request.onblocked = () => {
				this.#outcome = 'unavailable'
			}
		})
		return this.#track(promise)
	}
	acquireTransaction() {
		this.#eligible()
		const tx = required(this.#database).transaction(storeName, 'readwrite', {
			durability: 'strict'
		})
		this.#tx = tx
		this.#pending += 1
		tx.oncomplete = () => this.#terminalEvent('complete')
		tx.onabort = () => {
			if (tx.error) this.#fail(new BrowserJournalError('journalStoreFailed'))
			this.#terminalEvent('abort')
		}
		tx.onerror = (event) => {
			const error = event.target instanceof IDBRequest ? event.target.error : undefined
			if (error?.name === 'AbortError' && tx.error === null) return
			this.#fail(new BrowserJournalError('journalStoreFailed'))
			this.#observer?.({ type: 'TX_FAILED' })
		}
		this.#strict = tx.durability === 'strict'
		const store = tx.objectStore(storeName)
		this.#schema = store.keyPath === null && !store.autoIncrement && store.indexNames.length === 0
		if (!this.#strict || !this.#schema) this.#outcome = 'unavailable'
	}
	#terminalEvent(outcome: 'complete' | 'abort') {
		if (this.#terminal) return
		this.#terminal = outcome
		this.#settled()
		this.#observer?.({ type: outcome === 'complete' ? 'TX_COMPLETE' : 'TX_ABORTED' })
	}
	transactionAllowed(): boolean {
		return this.#strict && this.#schema && !this.#terminal
	}
	subscribe(observer: (event: BrowserJournalNativeEvent) => void): () => void {
		if (this.#observer) throw new BrowserJournalError('journalInUse')
		this.#observer = observer
		if (this.#terminal)
			observer({ type: this.#terminal === 'complete' ? 'TX_COMPLETE' : 'TX_ABORTED' })
		return () => {
			if (this.#observer === observer) this.#observer = undefined
		}
	}
	command(command: BrowserJournalNativeCommand) {
		try {
			if (command.type === 'ABORT') {
				this.abortTransaction()
				return
			}
			this.#eligible()
			const tx = required(this.#tx)
			if (command.type === 'COMMIT') {
				tx.commit()
				return
			}
			const store = tx.objectStore(storeName)
			if (command.type === 'READ') {
				const request = store.openCursor(this.#key)
				request.onsuccess = () => {
					this.#exists = request.result !== null
					const raw: unknown = request.result?.value
					if (this.#released) {
						if (raw instanceof Uint8Array) raw.fill(0)
					} else this.#raw = raw
					this.#observer?.({ type: 'READ_READY' })
				}
				return
			}
			const input = required(this.#command)
			if (input.mode !== 'create' && input.mode !== 'update')
				throw new BrowserJournalError('invalidJournalRequest')
			// Revalidate inside this still-exclusive native transaction, immediately before staging.
			if (!this.#validCandidate(input)) throw new BrowserJournalError('invalidJournalRequest')
			this.#stagedBytes = encodeRestoreJournalRecord(input.record)
			this.#writeQueued = true
			const request =
				input.mode === 'create'
					? store.add(this.#stagedBytes, this.#key)
					: store.put(this.#stagedBytes, this.#key)
			request.onsuccess = () => {
				this.#staged = true
				this.#observer?.({ type: 'STAGED' })
			}
		} catch (error) {
			this.#fail(error)
			this.#observer?.({ type: 'TX_FAILED' })
			this.abortTransaction()
		}
	}
	#validCandidate(input: Extract<BrowserJournalCommand, { mode: 'create' | 'update' }>): boolean {
		const record = input.record
		if (!matchesBinding(record, this.binding)) return false
		if (input.mode === 'create') return !this.#exists && record.revision === 0
		return (
			this.#observed?.revision === input.expectedRevision &&
			isValidatedRestoreJournalSuccessor(this.#observed, record)
		)
	}
	/** Synchronous pure decision. The chart must not await between READ_READY and WRITE/COMMIT. */
	decide(): BrowserJournalDecision {
		try {
			this.#eligible()
			const command = required(this.#command)
			if (command.mode === 'initialize') throw new BrowserJournalError('invalidJournalRequest')
			if (!this.#exists) {
				if (command.mode === 'create') {
					this.#outcome = 'created'
					return 'write'
				}
				this.#outcome = 'missing'
				return 'abort'
			}
			if (!(this.#raw instanceof Uint8Array)) throw new RestoreJournalError('invalidJournal')
			this.#observed = decodeRestoreJournalRecord(this.#raw)
			const expected = command.mode === 'load' ? command.intent : command.record.intent
			if (
				!matchesBinding(this.#observed, this.binding) ||
				JSON.stringify(this.#observed.intent) !== JSON.stringify(expected)
			) {
				this.#observed = undefined
				this.#outcome = 'conflict'
				return 'abort'
			}
			if (command.mode === 'load') {
				this.#outcome = 'loaded'
				return 'observe'
			}
			if (command.mode === 'create') {
				this.#outcome = 'existing'
				return 'observe'
			}
			if (sameRecord(this.#observed, command.record)) {
				this.#outcome = 'existing'
				return 'observe'
			}
			if (!this.#validCandidate(command)) {
				this.#outcome = 'conflict'
				return 'abort'
			}
			this.#outcome = 'updated'
			return 'write'
		} catch (error) {
			this.#fail(error)
			return 'abort'
		} finally {
			if (this.#raw instanceof Uint8Array) this.#raw.fill(0)
			this.#raw = undefined
		}
	}
	abortTransaction() {
		if (!this.#tx || this.#terminal) return
		try {
			this.#tx.abort()
		} catch (error) {
			// A transaction already committing/finished cannot be undone. Await its retained terminal.
			if (!(error instanceof DOMException && error.name === 'InvalidStateError')) this.#fail(error)
		}
	}
	abort() {
		this.#controller.abort()
		this.abortTransaction()
	}
	drain(): Promise<void> {
		if (this.#pending === 0) return Promise.resolve()
		return new Promise((resolve) => this.#idle.add(resolve))
	}
	closeDatabase() {
		if (this.#pending !== 0) throw new BrowserJournalError('journalCleanupFailed')
		try {
			this.#database?.close()
		} catch {
			this.#fail(new BrowserJournalError('journalCleanupFailed'))
			throw new BrowserJournalError('journalCleanupFailed')
		}
		if (this.#database) this.#database.onversionchange = null
		this.#database = undefined
		if (this.#tx) {
			this.#tx.oncomplete = null
			this.#tx.onabort = null
			this.#tx.onerror = null
		}
		this.#tx = undefined
		this.#stagedBytes?.fill(0)
		this.#stagedBytes = undefined
	}
	#fallbackCleanup() {
		if (this.#pending !== 0 || this.#failure === 'journalCleanupFailed') return
		try {
			this.closeDatabase()
		} catch {
			return
		}
	}
	release() {
		this.#released = true
		this.abort()
		this.#view?.clear()
		this.#view = undefined
		this.#command = undefined
		this.#observed = undefined
		if (this.#raw instanceof Uint8Array) this.#raw.fill(0)
		this.#raw = undefined
		this.#fallbackCleanup()
	}
	complete(
		interruption?: BrowserJournalInterruption,
		failure?: BrowserJournalErrorCode,
		outcome?: 'unavailable'
	): BrowserJournalResult {
		const committed = this.#writeQueued && this.#staged && this.#terminal === 'complete'
		const command = this.#command
		const observed =
			this.#terminal === 'complete'
				? committed && command && (command.mode === 'create' || command.mode === 'update')
					? command.record
					: this.#observed
				: undefined
		if (!this.#released && observed && !this.#view) this.#view = new RecordView(observed)
		const facts = {
			binding: this.binding,
			journal: {
				settlement: committed
					? 'committed'
					: this.#writeQueued
						? this.#terminal === 'abort'
							? 'aborted'
							: 'unknown'
						: 'notStarted',
				durability: this.#strict ? 'strict' : null
			},
			...(this.#view ? { record: this.#view } : {})
		} satisfies Pick<BrowserJournalResult, 'binding' | 'journal' | 'record'>
		const code =
			this.#failure === 'journalCleanupFailed' || failure === 'journalCleanupFailed'
				? 'journalCleanupFailed'
				: (this.#failure ?? failure)
		if (code === 'journalCleanupFailed') return { ...facts, outcome: 'failed', code }
		if (interruption) return { ...facts, outcome: interruption }
		if (this.#released) return { ...facts, outcome: 'closed' }
		if (code) return { ...facts, outcome: 'failed', code }
		if (outcome) return { ...facts, outcome }
		if ((this.#outcome === 'created' || this.#outcome === 'updated') && !committed)
			return { ...facts, outcome: 'failed', code: 'journalStoreFailed' }
		if (
			(this.#outcome === 'initialized' ||
				this.#outcome === 'loaded' ||
				this.#outcome === 'existing') &&
			this.#terminal !== 'complete'
		)
			return { ...facts, outcome: 'failed', code: 'journalStoreFailed' }
		return { ...facts, outcome: this.#outcome }
	}
}

const operations = new WeakMap<BrowserJournalRequest, BrowserJournalOperation>()
export function browserJournalOperation(request: BrowserJournalRequest) {
	return required(operations.get(request))
}
export function prepareBrowserRestoreJournal(options: {
	databaseName: string
	binding: BackupBinding
	command: BrowserJournalCommand
}): BrowserJournalRequest {
	const name = z
		.string()
		.min(1)
		.max(256)
		.refine(wellFormed)
		.refine((value) => new TextEncoder().encode(value).length <= 256)
		.safeParse(options.databaseName)
	const binding = backupBindingSchema.safeParse(options.binding)
	if (!name.success || !binding.success) throw new BrowserJournalError('invalidJournalRequest')
	let command: BrowserJournalCommand
	if (options.command.mode === 'initialize') command = { mode: 'initialize' }
	else if (options.command.mode === 'load')
		command = { mode: 'load', intent: createRestoreJournalRecord(options.command.intent).intent }
	else if (options.command.mode === 'create' || options.command.mode === 'update') {
		const record = parseRestoreJournalRecord(options.command.record)
		if (options.command.mode === 'create') {
			if (record.revision !== 0) throw new BrowserJournalError('invalidJournalRequest')
			command = { mode: 'create', record }
		} else {
			const revision = options.command.expectedRevision
			if (
				!Number.isSafeInteger(revision) ||
				revision < 0 ||
				Object.is(revision, -0) ||
				record.revision !== revision + 1
			)
				throw new BrowserJournalError('invalidJournalRequest')
			command = { mode: 'update', expectedRevision: revision, record }
		}
	} else throw new BrowserJournalError('invalidJournalRequest')
	if (command.mode !== 'initialize') {
		const record =
			command.mode === 'load' ? createRestoreJournalRecord(command.intent) : command.record
		if (!matchesBinding(record, binding.data))
			throw new BrowserJournalError('invalidJournalRequest')
	}
	const operation = new BrowserJournalOperation(name.data, binding.data, command)
	const request: BrowserJournalRequest = Object.freeze({
		release: () => operation.release(),
		toJSON: (): { kind: 'browserJournalRequest' } => ({ kind: 'browserJournalRequest' })
	})
	operations.set(request, operation)
	return request
}
