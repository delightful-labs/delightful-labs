import { z } from 'zod'
import { createPayloadSchemas } from './schemas.js'
import { encodeArchivePayload, parseArchivePayload } from './payload.js'
import {
	envelopeOperation,
	prepareArchiveSeal,
	type ArchiveEnvelopeRequest,
	type ArchiveProtection,
	type SealedArchive
} from './envelope-operation.js'
import { ArchiveEnvelopeError, type EnvelopeErrorCode } from './envelope.js'
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
const bindingSchema = z
	.strictObject({
		applicationId: identifier,
		environment: identifier,
		identityId: identifier,
		workspaceId: identifier,
		generation: z.int().nonnegative(),
		operationId: identifier
	})
	.readonly()
export type BackupBinding = z.infer<typeof bindingSchema>

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
	/** One explicit lease-release retry after completion/teardown. Rejects while work is issued. */
	retryCleanup(): Promise<void>
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
export class ArchiveExportError extends Error {
	constructor(readonly code: ArchiveExportErrorCode) {
		super(code)
		this.name = 'ArchiveExportError'
	}
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

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new ArchiveExportError('exportReleased')
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

/** Private resource boundary. Methods are one leaf or a synchronous bounded transform. */
class ExportOperation {
	#source: ArchiveCaptureSource | undefined
	#handoff: ArchiveFileHandoff | undefined
	#profile: ArchiveProfileValidator | undefined
	#protection: ArchiveProtection | undefined
	#lease: ArchiveCaptureLease | undefined
	#releasePromise: Promise<void> | undefined
	#cleanupFailed = false
	#captured: unknown
	#payload: ArchivePayload | undefined
	#envelope: ArchiveEnvelopeRequest | undefined
	#sealed: SealedArchive | undefined
	#abort = new AbortController()
	#pending = 0
	#idleWaiters = new Set<() => void>()
	#claimed = false
	#released = false
	readonly binding: BackupBinding
	readonly limits: PayloadLimits
	constructor(options: {
		binding: BackupBinding
		source: ArchiveCaptureSource
		handoff: ArchiveFileHandoff
		profile: ArchiveProfileValidator
		protection: ArchiveProtection
		limits: PayloadLimits
	}) {
		this.binding = options.binding
		this.limits = options.limits
		this.#source = options.source
		this.#handoff = options.handoff
		this.#profile = options.profile
		this.#protection = options.protection
	}
	claim() {
		if (this.#released) throw new ArchiveExportError('exportReleased')
		if (this.#claimed) throw new ArchiveExportError('exportInUse')
		this.#claimed = true
	}
	#eligible() {
		if (this.#released || this.#abort.signal.aborted) throw new ArchiveExportError('exportReleased')
	}
	/** Retain acquisitions before promise completion; cleanup sees even a late acquired lease. */
	#track<T>(issue: () => Promise<T>, accept: (value: T) => void): Promise<void> {
		this.#eligible()
		this.#pending += 1
		return Promise.resolve()
			.then(() => {
				this.#eligible()
				return issue()
			})
			.then(accept)
			.finally(() => {
				this.#settled()
			})
	}
	checkAuthority(): Promise<void> {
		return this.#track(
			() => required(this.#source).checkAuthority(this.binding, this.#abort.signal),
			(allowed) => {
				if (!allowed) throw new ArchiveExportError('authorityDenied')
			}
		)
	}
	acquire(): Promise<void> {
		return this.#track(
			() => required(this.#source).acquire(this.binding, this.#abort.signal),
			(lease) => {
				this.#lease = lease
			}
		)
	}
	drain(): Promise<void> {
		return this.#track(
			() => required(this.#lease).drain(this.#abort.signal),
			() => {}
		)
	}
	read(): Promise<void> {
		return this.#track(
			() => required(this.#lease).read(this.#abort.signal, this.limits),
			(payload) => {
				if (!this.#released && !this.#abort.signal.aborted) this.#captured = payload
			}
		)
	}
	validate() {
		this.#eligible()
		const bytes = encodeArchivePayload(this.#captured, this.limits)
		this.#captured = undefined
		try {
			const payload = parseArchivePayload(bytes, this.limits)
			const profile = required(this.#profile)
			if (
				payload.profile.id !== profile.id ||
				payload.profile.version !== profile.version ||
				payload.source.applicationId !== this.binding.applicationId ||
				payload.source.workspaceId !== this.binding.workspaceId ||
				!profile.validate(payload)
			)
				throw new ArchiveExportError('profileInvalid')
			this.#payload = payload
		} finally {
			bytes.fill(0)
		}
	}
	checkConsistency(): Promise<void> {
		return this.#track(
			() => required(this.#lease).checkConsistency(this.#abort.signal),
			(consistent) => {
				if (!consistent) throw new ArchiveExportError('captureInconsistent')
			}
		)
	}
	releaseLease(): Promise<void> {
		if (this.#releasePromise) return this.#releasePromise
		const lease = this.#lease
		if (!lease) return Promise.resolve()
		this.#releasePromise = Promise.resolve()
			.then(() => lease.release())
			.then(() => {
				this.#lease = undefined
				this.#cleanupFailed = false
			})
			.catch(() => {
				this.#cleanupFailed = true
				throw new ArchiveExportError('captureCleanupFailed')
			})
			.finally(() => {
				this.#releasePromise = undefined
			})
		return this.#releasePromise
	}
	prepareEnvelope(): ArchiveEnvelopeRequest {
		this.#eligible()
		this.#envelope = prepareArchiveSeal(
			required(this.#payload),
			required(this.#protection),
			this.limits
		)
		this.#payload = undefined
		this.#protection = undefined
		envelopeOperation(this.#envelope).retainSealedOutput((archive) => {
			this.#sealed = archive
			if (this.#released) archive.release()
		})
		return this.#envelope
	}
	/** Handoff is one consumer effect. A throw cannot prove the effect never dispatched. */
	dispatch(): Promise<ArchiveHandoffObservation> {
		this.#eligible()
		const archive = required(this.#sealed)
		const file: ArchiveHandoffFile = Object.freeze({
			copyBytes: () => archive.copyBytes(),
			toJSON: (): { kind: 'sealedArchive' } => ({ kind: 'sealedArchive' })
		})
		this.#pending += 1
		return Promise.resolve()
			.then(() => {
				this.#eligible()
				return required(this.#handoff).dispatch(file, this.binding, this.#abort.signal)
			})
			.then((observation): ArchiveHandoffObservation => {
				if (observation === 'dispatched' || observation === 'rejected') return observation
				return 'unknown'
			})
			.catch((): ArchiveHandoffObservation => 'unknown')
			.finally(() => {
				this.#settled()
			})
	}
	#settled() {
		this.#pending -= 1
		if (this.#pending === 0) {
			for (const resolve of this.#idleWaiters) resolve()
			this.#idleWaiters.clear()
		}
		if (this.#released) this.#clear()
	}
	drainIssued(): Promise<void> {
		if (this.#pending === 0) return Promise.resolve()
		return new Promise((resolve) => this.#idleWaiters.add(resolve))
	}
	abort() {
		this.#abort.abort()
	}
	release() {
		this.finish()
	}
	retryCleanup(): Promise<void> {
		if (!this.#released || this.#pending !== 0)
			return Promise.reject(new ArchiveExportError('exportInUse'))
		return this.releaseLease()
	}
	finish() {
		this.#released = true
		this.abort()
		this.#clear()
	}
	#clear() {
		this.#captured = undefined
		this.#payload = undefined
		this.#protection = undefined
		this.#profile = undefined
		this.#envelope?.release()
		this.#envelope = undefined
		// An issued handoff may still be reading its borrowed handle. Drain before clearing it.
		if (this.#pending !== 0) return
		this.#sealed?.release()
		this.#sealed = undefined
		this.#source = undefined
		this.#handoff = undefined
		if (!this.#cleanupFailed) void this.releaseLease().catch(() => {})
	}
}

const exports = new WeakMap<ArchiveExportRequest, ExportOperation>()
export function exportOperation(request: ArchiveExportRequest) {
	return required(exports.get(request))
}
export function prepareArchiveExport(options: {
	binding: BackupBinding
	source: ArchiveCaptureSource
	handoff: ArchiveFileHandoff
	profile: ArchiveProfileValidator
	protection: ArchiveProtection
	limits?: PayloadLimitOverrides
}): ArchiveExportRequest {
	const binding = bindingSchema.safeParse(options.binding)
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
		throw new ArchiveExportError('invalidExportConfiguration')
	const operation = new ExportOperation({
		binding: binding.data,
		source: options.source,
		handoff: options.handoff,
		profile: Object.freeze({ ...profile.data, validate: options.profile.validate }),
		protection: Object.freeze(protection.data),
		limits
	})
	const request: ArchiveExportRequest = Object.freeze({
		release: () => operation.release(),
		retryCleanup: () => operation.retryCleanup(),
		toJSON: (): { kind: 'archiveExportRequest' } => ({ kind: 'archiveExportRequest' })
	})
	exports.set(request, operation)
	return request
}
export function exportFailure(error: unknown): {
	outcome: 'failed'
	code: ArchiveExportErrorCode | ArchivePayloadErrorCode | EnvelopeErrorCode
} {
	if (
		error instanceof ArchiveExportError ||
		error instanceof ArchivePayloadError ||
		error instanceof ArchiveEnvelopeError
	)
		return { outcome: 'failed', code: error.code }
	return { outcome: 'failed', code: 'exportFailed' }
}
