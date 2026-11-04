import { z } from 'zod'
import { backupBindingSchema, type BackupBinding } from './export.js'
import { wellFormed } from './schemas.js'
import {
	createRestoreJournalRecord,
	isRestoreJournalError,
	isRestoreJournalErrorCode,
	parseRestoreJournalRecord,
	type RestoreJournalErrorCode,
	type RestoreJournalIntent,
	type RestoreJournalRecord
} from './restore-journal.js'

export type BrowserJournalCommand =
	| { mode: 'initialize' }
	| { mode: 'discover' }
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
export function createBrowserJournalError(code: BrowserJournalErrorCode) {
	return Object.assign(new Error(code), { name: 'BrowserJournalError', code })
}
export function isBrowserJournalError(
	error: unknown
): error is ReturnType<typeof createBrowserJournalError> {
	return (
		error instanceof Error &&
		error.name === 'BrowserJournalError' &&
		'code' in error &&
		(isRestoreJournalErrorCode(error.code) ||
			error.code === 'invalidJournalRequest' ||
			error.code === 'journalInUse' ||
			error.code === 'journalReleased' ||
			error.code === 'journalStoreFailed' ||
			error.code === 'journalCleanupFailed')
	)
}
export function browserJournalFailure(error: unknown): BrowserJournalErrorCode {
	return isBrowserJournalError(error) || isRestoreJournalError(error)
		? error.code
		: 'journalStoreFailed'
}
export interface BrowserJournalRecordView {
	/** Borrowed immutable metadata, invalidated by request.release(). */
	readRecord(): RestoreJournalRecord
	toJSON(): { kind: 'browserJournalRecord' }
}
export interface BrowserJournalRequest {
	/** Revoke input/result references and request owner shutdown. Drain before actor.stop(). */
	release(): void
	toJSON(): { kind: 'browserJournalRequest' }
}
export type BrowserJournalOutcome =
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
	| { outcome: BrowserJournalOutcome | BrowserJournalInterruption }
	| { outcome: 'failed'; code: BrowserJournalErrorCode }
)

export type BrowserJournalConfiguration = {
	databaseName: string
	binding: BackupBinding
	command: BrowserJournalCommand
}
/** Private payload/reference storage only. The machine owns every workflow decision and transition. */
type JournalData = {
	configuration: BrowserJournalConfiguration | undefined
	raw: unknown
	observed: RestoreJournalRecord | undefined
	encoded: Uint8Array<ArrayBuffer> | undefined
	result: RestoreJournalRecord | undefined
	releaseControl: (() => void) | undefined
	view: BrowserJournalRecordView
}
type Prepared = {
	binding: BackupBinding
	data: JournalData
	take(): void
}
const requests = new WeakMap<BrowserJournalRequest, Prepared>()
function prepared(request: BrowserJournalRequest): Prepared {
	const value = requests.get(request)
	if (!value) throw createBrowserJournalError('invalidJournalRequest')
	return value
}
export function browserJournalBinding(request: BrowserJournalRequest) {
	return prepared(request).binding
}
export function claimBrowserJournalRequest(request: BrowserJournalRequest) {
	prepared(request).take()
}
export function browserJournalData(request: BrowserJournalRequest) {
	return prepared(request).data
}
export function clearBrowserJournalBuffers(request: BrowserJournalRequest) {
	const data = browserJournalData(request)
	if (data.raw instanceof Uint8Array) data.raw.fill(0)
	data.raw = undefined
	data.encoded?.fill(0)
	data.encoded = undefined
}
export function matchesJournalBinding(
	record: RestoreJournalRecord,
	binding: BackupBinding
): boolean {
	const scope = record.intent.operation
	return (
		scope.applicationId === binding.applicationId &&
		scope.environment === binding.environment &&
		scope.identityId === binding.identityId &&
		scope.operationId === binding.operationId &&
		scope.destinationWorkspaceId === binding.workspaceId
	)
}
export function prepareBrowserRestoreJournal(
	options: BrowserJournalConfiguration
): BrowserJournalRequest {
	const name = z
		.string()
		.min(1)
		.max(256)
		.refine(wellFormed)
		.refine((value) => new TextEncoder().encode(value).length <= 256)
		.safeParse(options.databaseName)
	const binding = backupBindingSchema.safeParse(options.binding)
	if (!name.success || !binding.success) throw createBrowserJournalError('invalidJournalRequest')
	let command: BrowserJournalCommand
	if (options.command.mode === 'initialize') command = { mode: 'initialize' }
	else if (options.command.mode === 'discover') command = { mode: 'discover' }
	else if (options.command.mode === 'load')
		command = { mode: 'load', intent: createRestoreJournalRecord(options.command.intent).intent }
	else if (options.command.mode === 'create' || options.command.mode === 'update') {
		const record = parseRestoreJournalRecord(options.command.record)
		if (options.command.mode === 'create') {
			if (record.revision !== 0) throw createBrowserJournalError('invalidJournalRequest')
			command = { mode: 'create', record }
		} else {
			const revision = options.command.expectedRevision
			if (
				!Number.isSafeInteger(revision) ||
				revision < 0 ||
				Object.is(revision, -0) ||
				record.revision !== revision + 1
			)
				throw createBrowserJournalError('invalidJournalRequest')
			command = { mode: 'update', expectedRevision: revision, record }
		}
	} else throw createBrowserJournalError('invalidJournalRequest')
	if (command.mode !== 'initialize' && command.mode !== 'discover') {
		const record =
			command.mode === 'load' ? createRestoreJournalRecord(command.intent) : command.record
		if (!matchesJournalBinding(record, binding.data))
			throw createBrowserJournalError('invalidJournalRequest')
	}
	const data: JournalData = {
		configuration: { databaseName: name.data, binding: binding.data, command },
		raw: undefined,
		observed: undefined,
		encoded: undefined,
		result: undefined,
		releaseControl: undefined,
		view: Object.freeze({
			readRecord() {
				if (!data.result) throw createBrowserJournalError('journalReleased')
				return data.result
			},
			toJSON: (): { kind: 'browserJournalRecord' } => ({ kind: 'browserJournalRecord' })
		})
	}
	// Consuming the prepared capability is one atomic admission leaf, not a second lifecycle owner.
	let available: JournalData | undefined = data
	const request: BrowserJournalRequest = Object.freeze({
		release() {
			data.releaseControl?.()
			data.configuration = undefined
			data.result = undefined
			data.observed = undefined
			clearBrowserJournalBuffers(request)
		},
		toJSON: (): { kind: 'browserJournalRequest' } => ({ kind: 'browserJournalRequest' })
	})
	requests.set(request, {
		binding: binding.data,
		data,
		take() {
			if (!data.configuration) throw createBrowserJournalError('journalReleased')
			if (!available) throw createBrowserJournalError('journalInUse')
			available = undefined
		}
	})
	return request
}
