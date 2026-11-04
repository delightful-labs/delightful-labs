import { z } from 'zod'
import { createPayloadSchemas } from './schemas.js'
import { encodeArchivePayload, parseArchivePayload } from './payload.js'
import {
	retainSealedOutput,
	prepareArchiveSeal,
	type ArchiveEnvelopeRequest,
	type ArchiveProtection,
	type SealedArchive
} from './envelope-operation.js'
import { isArchiveEnvelopeError, type EnvelopeErrorCode } from './envelope.js'
import type { ArchiveProfileValidator } from './inspection.js'
import {
	ArchivePayloadError,
	resolvePayloadLimits,
	type ArchivePayload,
	type ArchivePayloadErrorCode,
	type PayloadLimitOverrides,
	type PayloadLimits
} from './types.js'

const identifier = z.string().min(1).max(256)
export const backupBindingSchema = z
	.strictObject({
		applicationId: identifier,
		environment: identifier,
		identityId: identifier,
		workspaceId: identifier,
		generation: z.int().nonnegative(),
		operationId: identifier
	})
	.readonly()
export type BackupBinding = z.infer<typeof backupBindingSchema>

export interface ArchiveCaptureLease {
	/** One acknowledgement that the consumer's existing writers have drained. */
	drain(signal: AbortSignal): Promise<void>
	/** One bounded read of the complete supported graph. No lazy SDK objects or accessors. */
	read(signal: AbortSignal, limits: PayloadLimits): Promise<unknown>
	/** One observation proving the lease's captured graph stayed consistent and authorized. */
	checkConsistency(signal: AbortSignal): Promise<boolean>
	/** Release only this lease; idempotent, and never interrupted by cancellation. */
	release(): Promise<void>
}
export interface ArchiveCaptureSource {
	/** One current authority observation for this exact generation, never cached UUID equality. */
	checkAuthority(binding: BackupBinding, signal: AbortSignal): Promise<boolean>
	/** Must recheck authority at acquisition; late acquired leases still transfer ownership. */
	acquire(binding: BackupBinding, signal: AbortSignal): Promise<ArchiveCaptureLease>
}
export type ArchiveHandoffObservation = 'dispatched' | 'rejected' | 'unknown'
export type ArchiveHandoffFile = Pick<SealedArchive, 'copyBytes' | 'toJSON'>
export interface ArchiveFileHandoff {
	/** One effect, rechecking the binding before dispatch. Does not establish retained-file safety.
	 * Copies obtained from archive are consumer-owned and must be cleared/released by the consumer.
	 */
	dispatch(
		archive: ArchiveHandoffFile,
		binding: BackupBinding,
		signal: AbortSignal
	): Promise<ArchiveHandoffObservation>
}
export interface ArchiveExportRequest {
	/** Abrupt teardown fallback. Abort, discard late data and attempt owned lease release.
	 * Await machine completion after CANCEL/SHUTDOWN for a graceful drain acknowledgement.
	 */
	release(): void
	toJSON(): { kind: 'archiveExportRequest' }
}
export type ArchiveExportInterruption = 'cancelled' | 'closed' | 'invalidated'
export type ArchiveExportErrorCode =
	| 'invalidExportConfiguration'
	| 'exportInUse'
	| 'exportReleased'
	| 'authorityDenied'
	| 'captureInconsistent'
	| 'profileInvalid'
	| 'captureCleanupFailed'
	| 'exportFailed'
export function createArchiveExportError(code: ArchiveExportErrorCode) {
	return Object.assign(new Error(code), { name: 'ArchiveExportError', code })
}
export function isArchiveExportError(
	error: unknown
): error is ReturnType<typeof createArchiveExportError> {
	return (
		error instanceof Error &&
		error.name === 'ArchiveExportError' &&
		'code' in error &&
		(error.code === 'invalidExportConfiguration' ||
			error.code === 'exportInUse' ||
			error.code === 'exportReleased' ||
			error.code === 'authorityDenied' ||
			error.code === 'captureInconsistent' ||
			error.code === 'profileInvalid' ||
			error.code === 'captureCleanupFailed' ||
			error.code === 'exportFailed')
	)
}
export type ArchiveExportResult = Readonly<{
	binding: BackupBinding
	archiveProduced: boolean
	handoff: ArchiveHandoffObservation | 'notStarted'
}> &
	(
		| { outcome: 'exported' | ArchiveExportInterruption }
		| {
				outcome: 'failed'
				code: ArchiveExportErrorCode | ArchivePayloadErrorCode | EnvelopeErrorCode
		  }
	)
export type ArchiveCaptureResult =
	| { outcome: 'captured' | ArchiveExportInterruption }
	| ReturnType<typeof exportFailure>

export function requireExportValue<T>(value: T | undefined): T {
	if (value === undefined) throw createArchiveExportError('exportReleased')
	return value
}
export function sameBackupBinding(left: BackupBinding, right: BackupBinding): boolean {
	return (
		left.applicationId === right.applicationId &&
		left.environment === right.environment &&
		left.identityId === right.identityId &&
		left.workspaceId === right.workspaceId &&
		left.generation === right.generation &&
		left.operationId === right.operationId
	)
}

/** Pure bounded structural/domain transform; no I/O or resource-lifetime decisions. */
export function validateExportPayload(
	captured: unknown,
	profile: ArchiveProfileValidator,
	binding: BackupBinding,
	limits: PayloadLimits
): ArchivePayload {
	const bytes = encodeArchivePayload(captured, limits)
	try {
		const payload = parseArchivePayload(bytes, limits)
		if (
			payload.profile.id !== profile.id ||
			payload.profile.version !== profile.version ||
			payload.source.applicationId !== binding.applicationId ||
			payload.source.workspaceId !== binding.workspaceId ||
			!profile.validate(payload)
		)
			throw createArchiveExportError('profileInvalid')
		return payload
	} finally {
		bytes.fill(0)
	}
}

type ExportInputData = {
	source: ArchiveCaptureSource
	handoff: ArchiveFileHandoff
	profile: ArchiveProfileValidator
	protection: ArchiveProtection | undefined
}
export type ExportCleanupCustody = { lease: ArchiveCaptureLease | undefined }
/** Payload/native resource facts only; the charts own admission, sequencing and drain. */
type ExportData = {
	readonly binding: BackupBinding
	readonly limits: PayloadLimits
	input: ExportInputData | undefined
	lease: ArchiveCaptureLease | undefined
	failedLease: ArchiveCaptureLease | undefined
	captured: unknown
	payload: ArchivePayload | undefined
	envelope: ArchiveEnvelopeRequest | undefined
	sealed: SealedArchive | undefined
	readonly abort: AbortController
	issued: Promise<unknown> | undefined
	cleanup: ExportCleanupCustody | undefined
	releaseControl: (() => void) | undefined
}
type PreparedExport = { data: ExportData; claim(): void }
const exports = new WeakMap<ArchiveExportRequest, PreparedExport>()
function prepared(request: ArchiveExportRequest) {
	return requireExportValue(exports.get(request))
}
export function exportData(request: ArchiveExportRequest) {
	return prepared(request).data
}
export function claimExportRequest(request: ArchiveExportRequest) {
	prepared(request).claim()
}
/** Transfer cleanup custody only after the native borrower has returned or disposed its resources. */
export function publishExportCleanup(request: ArchiveExportRequest) {
	const data = exportData(request)
	if (
		data.releaseControl !== undefined ||
		data.input !== undefined ||
		data.issued !== undefined ||
		data.lease !== undefined ||
		data.cleanup !== undefined
	)
		return
	data.cleanup = { lease: data.failedLease }
	data.failedLease = undefined
}
export function takeExportCleanup(request: ArchiveExportRequest): ExportCleanupCustody {
	const data = exportData(request)
	if (data.cleanup === undefined) throw createArchiveExportError('exportInUse')
	const custody = data.cleanup
	data.cleanup = undefined
	return custody
}
/** Clearing payload references is synchronous. Native resource release belongs to its leaf adapter. */
export function clearExportData(request: ArchiveExportRequest) {
	const data = exportData(request)
	data.input = undefined
	data.captured = undefined
	data.payload = undefined
	data.envelope?.release()
	data.envelope = undefined
	data.sealed?.release()
	data.sealed = undefined
}
export function validateCapturedExport(request: ArchiveExportRequest) {
	const data = exportData(request)
	const input = requireExportValue(data.input)
	const captured = data.captured
	data.captured = undefined
	data.payload = validateExportPayload(captured, input.profile, data.binding, data.limits)
}
export function prepareExportEnvelope(request: ArchiveExportRequest): ArchiveEnvelopeRequest {
	const data = exportData(request)
	const input = requireExportValue(data.input)
	const envelope = prepareArchiveSeal(
		requireExportValue(data.payload),
		requireExportValue(input.protection),
		data.limits
	)
	data.envelope = envelope
	data.payload = undefined
	input.protection = undefined
	retainSealedOutput(envelope, (archive) => {
		data.sealed = archive
		if (data.input === undefined) archive.release()
	})
	return envelope
}
export type ArchiveExportCleanupResult =
	| { outcome: 'cleaned' }
	| { outcome: 'failed'; code: 'exportInUse' | 'captureCleanupFailed' | 'exportFailed' }
export function prepareArchiveExport(options: {
	binding: BackupBinding
	source: ArchiveCaptureSource
	handoff: ArchiveFileHandoff
	profile: ArchiveProfileValidator
	protection: ArchiveProtection
	limits?: PayloadLimitOverrides
}): ArchiveExportRequest {
	const binding = backupBindingSchema.safeParse(options.binding)
	const limits = resolvePayloadLimits(options.limits)
	const profile = createPayloadSchemas(limits).payload.unwrap().shape.profile.safeParse({
		id: options.profile.id,
		version: options.profile.version
	})
	const protection = z
		.discriminatedUnion('kind', [
			z.strictObject({ kind: z.literal('none') }),
			z.strictObject({ kind: z.literal('password'), password: z.string() })
		])
		.safeParse(options.protection)
	if (
		!binding.success ||
		!profile.success ||
		!protection.success ||
		typeof options.profile.validate !== 'function' ||
		typeof options.source?.checkAuthority !== 'function' ||
		typeof options.source?.acquire !== 'function' ||
		typeof options.handoff?.dispatch !== 'function'
	)
		throw createArchiveExportError('invalidExportConfiguration')
	const data: ExportData = {
		binding: binding.data,
		limits,
		input: {
			source: options.source,
			handoff: options.handoff,
			profile: Object.freeze({ ...profile.data, validate: options.profile.validate }),
			protection: Object.freeze(protection.data)
		},
		lease: undefined,
		failedLease: undefined,
		captured: undefined,
		payload: undefined,
		envelope: undefined,
		sealed: undefined,
		abort: new AbortController(),
		issued: undefined,
		cleanup: undefined,
		releaseControl: undefined
	}
	let available: ExportData | undefined = data
	const request: ArchiveExportRequest = Object.freeze({
		release() {
			if (data.input === undefined) return
			data.input = undefined
			available = undefined
			data.abort.abort()
			if (data.releaseControl) data.releaseControl()
			else {
				clearExportData(request)
				publishExportCleanup(request)
			}
		},
		toJSON: (): { kind: 'archiveExportRequest' } => ({ kind: 'archiveExportRequest' })
	})
	exports.set(request, {
		data,
		claim() {
			requireExportValue(data.input)
			if (available === undefined) throw createArchiveExportError('exportInUse')
			available = undefined
		}
	})
	return request
}
export function exportFailure(error: unknown): {
	outcome: 'failed'
	code: ArchiveExportErrorCode | ArchivePayloadErrorCode | EnvelopeErrorCode
} {
	if (
		isArchiveExportError(error) ||
		error instanceof ArchivePayloadError ||
		isArchiveEnvelopeError(error)
	)
		return { outcome: 'failed', code: error.code }
	return { outcome: 'failed', code: 'exportFailed' }
}
