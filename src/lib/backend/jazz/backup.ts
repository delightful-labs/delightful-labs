import { fromCallback } from 'xstate'
import {
	PersistedWriteRejectedError,
	type Db,
	type QueryBuilder,
	type Transaction
} from 'jazz-tools'
import { backupBindingSchema, type BackupBinding } from '../../backup/binding.js'
import { hex } from '../../backup/binary.js'
import {
	resolvePayloadLimits,
	isArchivePayloadError,
	type PayloadLimits,
	type PayloadLimitOverrides
} from '../../backup/types.js'
import {
	prepareArchiveSeal,
	envelopeData,
	retainSealedOutput,
	type ArchiveEnvelopeRequest,
	type ArchiveProtection,
	type SealedArchive
} from '../../backup/envelope-operation.js'
import type { ArchiveProfileValidator } from '../../backup/inspection.js'

export type ArchiveHandoffObservation = 'dispatched' | 'rejected' | 'unknown'
export type ArchiveHandoffFile = Pick<SealedArchive, 'copyBytes' | 'toJSON'>
export interface ArchiveFileHandoff {
	/** One dispatch effect. The consumer owns and must clear byte copies it takes. */
	dispatch(
		archive: ArchiveHandoffFile,
		binding: BackupBinding,
		signal: AbortSignal
	): Promise<ArchiveHandoffObservation>
}

export type JazzExportErrorCode =
	| 'inUse'
	| 'permissionDenied'
	| 'sourceChanged'
	| 'invalidData'
	| 'failed'
	| 'cleanupFailed'
export type JazzArchiveReaderResult =
	| { outcome: 'ready' | 'cancelled' }
	| { outcome: 'failed'; code: JazzExportErrorCode }
export interface JazzArchiveReaderInput {
	readonly mode: 'hydrate' | 'capture'
	readonly binding: BackupBinding
	readonly limits: PayloadLimits
	readonly signal: AbortSignal
	/** Complete, bounded queries only. The capability fixes the native scope and remote tier. */
	all<Row>(query: QueryBuilder<Row>): Promise<Row[]>
	/** Owned native digest. Its input copy remains private until the issued call settles. */
	sha256(bytes: Uint8Array): Promise<string>
	/** Capture-only deposit. Graph data never enters an actor snapshot or invocation output. */
	accept(payload: unknown): void
}
export interface JazzArchiveExportRequest {
	/** Abort, discard secrets immediately, then drain native I/O and release owned resources. */
	release(): Promise<void>
	toJSON(): { kind: 'jazzArchiveExport' }
}
export type JazzArchiveExportResult = {
	binding: BackupBinding
	archiveProduced: boolean
	handoff: ArchiveHandoffObservation | 'notStarted'
} & (
	| { outcome: 'exported' | 'cancelled' | 'closed' | 'invalidated' }
	| { outcome: 'failed'; code: JazzExportErrorCode }
)
type Options = {
	db: Pick<Db, 'all' | 'beginExclusiveTransaction' | 'getAuthState'>
	binding: BackupBinding
	profile: ArchiveProfileValidator
	protection: ArchiveProtection
	handoff: ArchiveFileHandoff
	/** Pure observation of this exact application attachment/generation. */
	isCurrent(): boolean
	limits?: PayloadLimitOverrides
}
type Data = {
	binding: BackupBinding
	limits: PayloadLimits
	input: (Omit<Options, 'protection'> & { protection: ArchiveProtection | undefined }) | undefined
	abort: AbortController
	pending: Set<Promise<unknown>>
	transaction: Transaction<'exclusive'> | undefined
	verdict: Promise<void> | undefined
	reader: JazzArchiveReaderInput | undefined
	captured: unknown
	envelope: ArchiveEnvelopeRequest | undefined
	sealed: SealedArchive | undefined
	archiveProduced: boolean
	handoff: ArchiveHandoffObservation | 'notStarted'
	cleanup: Promise<void> | undefined
}
const operations = new WeakMap<JazzArchiveExportRequest, Data>()
const available = new WeakSet<JazzArchiveExportRequest>()
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw fault('failed')
	return value
}
function fault(code: JazzExportErrorCode) {
	return Object.assign(new Error(code), { name: 'JazzExportError', code })
}
export function jazzExportFailure(error: unknown): JazzExportErrorCode {
	if (error instanceof PersistedWriteRejectedError) {
		if (error.code === 'exclusive_conflict' || error.code === 'transaction_conflict')
			return 'sourceChanged'
		if (error.code === 'permission_denied') return 'permissionDenied'
	}
	if (isArchivePayloadError(error)) return 'invalidData'
	if (error instanceof Error && error.name === 'JazzExportError' && 'code' in error) {
		if (
			error.code === 'inUse' ||
			error.code === 'permissionDenied' ||
			error.code === 'sourceChanged' ||
			error.code === 'invalidData' ||
			error.code === 'cleanupFailed'
		)
			return error.code
	}
	return 'failed'
}
function data(request: JazzArchiveExportRequest) {
	return required(operations.get(request))
}
function track<Value>(scope: Data, call: Promise<Value>): Promise<Value> {
	scope.pending.add(call)
	void call.then(
		() => scope.pending.delete(call),
		() => scope.pending.delete(call)
	)
	return call
}
export function assertJazzExportCurrent(request: JazzArchiveExportRequest) {
	const scope = data(request),
		input = required(scope.input)
	if (scope.abort.signal.aborted || !input.isCurrent()) throw fault('sourceChanged')
	if (input.db.getAuthState().session?.user.account !== scope.binding.identityId)
		throw fault('permissionDenied')
}
export function claimJazzExport(request: JazzArchiveExportRequest) {
	if (!available.delete(request)) throw fault('inUse')
}
export function endJazzReader(request: JazzArchiveExportRequest) {
	data(request).reader = undefined
}
export function abortJazzExport(request: JazzArchiveExportRequest) {
	const scope = data(request)
	scope.abort.abort()
	scope.reader = undefined
	scope.captured = undefined
	if (scope.input) scope.input.protection = undefined
	scope.envelope?.release()
}
export function jazzReaderInput(
	request: JazzArchiveExportRequest,
	mode: JazzArchiveReaderInput['mode']
): JazzArchiveReaderInput {
	const scope = data(request)
	const reader: JazzArchiveReaderInput = Object.freeze({
		mode,
		binding: scope.binding,
		limits: scope.limits,
		signal: scope.abort.signal,
		all<Row>(query: QueryBuilder<Row>) {
			assertJazzExportCurrent(request)
			if (scope.reader !== reader) throw fault('failed')
			const source = mode === 'hydrate' ? required(scope.input).db : required(scope.transaction)
			return track(scope, source.all(query, { tier: 'remote' })).then(
				(rows) => {
					if (scope.abort.signal.aborted) throw fault('sourceChanged')
					return rows
				},
				(error: unknown) => {
					throw fault(jazzExportFailure(error))
				}
			)
		},
		sha256(bytes: Uint8Array) {
			assertJazzExportCurrent(request)
			if (scope.reader !== reader || bytes.byteLength > scope.limits.attachmentBytes)
				throw fault('invalidData')
			const copy = Uint8Array.from(bytes)
			return track(
				scope,
				crypto.subtle
					.digest('SHA-256', copy)
					.then(hex)
					.finally(() => copy.fill(0))
			).then((value) => {
				if (scope.abort.signal.aborted) throw fault('sourceChanged')
				return value
			})
		},
		accept(payload: unknown) {
			if (mode === 'capture' && scope.reader === reader && !scope.abort.signal.aborted)
				scope.captured = payload
		}
	})
	scope.reader = reader
	return reader
}
export function openJazzExport(request: JazzArchiveExportRequest) {
	assertJazzExportCurrent(request)
	data(request).transaction = required(data(request).input).db.beginExclusiveTransaction()
}
export function validateJazzExport(request: JazzArchiveExportRequest) {
	const scope = data(request),
		captured = scope.captured
	scope.reader = undefined
	scope.captured = undefined
	try {
		const input = required(scope.input)
		scope.envelope = prepareArchiveSeal(captured, required(input.protection), scope.limits)
		input.protection = undefined
		const payload = required(envelopeData(scope.envelope).payload),
			profile = input.profile
		if (
			payload.profile.id !== profile.id ||
			payload.profile.version !== profile.version ||
			payload.source.applicationId !== scope.binding.applicationId ||
			payload.source.workspaceId !== scope.binding.workspaceId ||
			payload.coverage.consistency !== 'jazz-exclusive-transaction' ||
			!profile.validate(payload)
		)
			throw fault('invalidData')
	} catch {
		throw fault('invalidData')
	}
}
export function commitJazzExport(request: JazzArchiveExportRequest) {
	assertJazzExportCurrent(request)
	const scope = data(request),
		transaction = required(scope.transaction)
	const write = transaction.commit()
	scope.transaction = undefined
	// Register the native verdict at issue, including cancellation before the confirmation state.
	scope.verdict = track(
		scope,
		Promise.resolve(write.wait()).catch((error: unknown) => {
			throw fault(jazzExportFailure(error))
		})
	)
}
export function confirmJazzExport(request: JazzArchiveExportRequest) {
	return required(data(request).verdict)
}
export function protectJazzExport(request: JazzArchiveExportRequest): ArchiveEnvelopeRequest {
	assertJazzExportCurrent(request)
	const scope = data(request),
		envelope = required(scope.envelope)
	retainSealedOutput(envelope, (archive) => {
		scope.archiveProduced = true
		if (scope.abort.signal.aborted) archive.release()
		else scope.sealed = archive
	})
	return envelope
}
export function dispatchJazzExport(
	request: JazzArchiveExportRequest
): Promise<ArchiveHandoffObservation> {
	assertJazzExportCurrent(request)
	const scope = data(request),
		archive = required(scope.sealed),
		input = required(scope.input)
	scope.handoff = 'unknown'
	return track(
		scope,
		Promise.resolve().then(() => {
			assertJazzExportCurrent(request)
			return input.handoff.dispatch(
				Object.freeze({
					copyBytes: () => archive.copyBytes(),
					toJSON: (): { kind: 'sealedArchive' } => ({ kind: 'sealedArchive' })
				}),
				scope.binding,
				scope.abort.signal
			)
		})
	).then(
		(result) => {
			scope.handoff = result === 'dispatched' || result === 'rejected' ? result : 'unknown'
			return scope.handoff
		},
		() => {
			scope.handoff = 'unknown'
			return scope.handoff
		}
	)
}
export function jazzExportFacts(request: JazzArchiveExportRequest) {
	const scope = data(request)
	return { archiveProduced: scope.archiveProduced, handoff: scope.handoff }
}
export function jazzExportBinding(request: JazzArchiveExportRequest) {
	return data(request).binding
}

/** One request owns the native transaction and data. No writer registry or consumer lease protocol. */
export function prepareJazzArchiveExport(options: Options): JazzArchiveExportRequest {
	const scope: Data = {
		binding: backupBindingSchema.parse(options.binding),
		limits: resolvePayloadLimits(options.limits),
		input: { ...options, protection: { ...options.protection } },
		abort: new AbortController(),
		pending: new Set(),
		transaction: undefined,
		verdict: undefined,
		reader: undefined,
		captured: undefined,
		envelope: undefined,
		sealed: undefined,
		archiveProduced: false,
		handoff: 'notStarted',
		cleanup: undefined
	}
	const request: JazzArchiveExportRequest = Object.freeze({
		release() {
			abortJazzExport(request)
			if (scope.cleanup) return scope.cleanup
			available.delete(request)
			scope.cleanup = Promise.allSettled(scope.pending)
				.then(async () => {
					const transaction = scope.transaction
					if (transaction) {
						try {
							await transaction.rollback()
							scope.transaction = undefined
						} catch {
							throw fault('cleanupFailed')
						}
					}
				})
				.finally(() => {
					scope.sealed?.release()
					scope.sealed = undefined
					scope.envelope = undefined
					scope.input = undefined
					scope.verdict = undefined
				})
			return scope.cleanup
		},
		toJSON: (): { kind: 'jazzArchiveExport' } => ({ kind: 'jazzArchiveExport' })
	})
	operations.set(request, scope)
	available.add(request)
	return request
}
/** Direct native custody survives a failed reader and XState's unexpected-error stop ordering. */
export const jazzExportResources = fromCallback<
	{ type: string },
	{
		request: JazzArchiveExportRequest
		owner: { subscribe(observer: { error(): void }): { unsubscribe(): void } }
	}
>(({ input }) => {
	const release = () => {
		void input.request.release().catch(() => {})
	}
	const subscription = input.owner.subscribe({ error: release })
	return () => {
		subscription.unsubscribe()
		release()
	}
})
