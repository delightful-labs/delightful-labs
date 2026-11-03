import { z } from 'zod'
import {
	ArchiveEnvelopeError,
	parseEnvelope,
	envelopeBytesLimit,
	type EnvelopeErrorCode
} from './envelope.js'
import {
	envelopeOperation,
	prepareArchiveOpen,
	type ArchiveEnvelopeRequest,
	type ArchiveEnvelopeResult,
	type IntegrityCheckedArchive
} from './envelope-operation.js'
import {
	ArchivePayloadError,
	resolvePayloadLimits,
	type ArchivePayload,
	type ArchivePayloadErrorCode,
	type PayloadLimitOverrides
} from './types.js'

export interface ArchiveInspectionSource {
	/** One bounded read. Transfers ownership of the returned bytes; must observe cancellation. */
	read(signal: AbortSignal, maximumBytes: number): Promise<Uint8Array>
}
export interface ArchivePasswordSource {
	read(signal: AbortSignal): Promise<string>
}
export interface ArchiveProfileValidator {
	id: string
	version: number
	/** Pure synchronous domain validation; never I/O, ownership checks or destination writes. */
	validate(payload: ArchivePayload): boolean
}
export interface ArchiveInspectionRequest {
	release(): void
	toJSON(): { kind: 'archiveInspectionRequest' }
}
export type InspectionValidation =
	| 'integrityValidProfileUnsupported'
	| 'profileValid'
	| 'profileInvalid'
export type ArchiveInspectionSummary = Readonly<{
	archiveId: string
	profile: ArchivePayload['profile']
	declaredSource: ArchivePayload['source']
	protection: 'none' | 'password'
	payloadSha256: string
	records: number
	references: number
	attachments: number
	attachmentBytes: number
}>
export interface ArchiveInspectionReport {
	readSummary(): ArchiveInspectionSummary
	release(): void
	toJSON(): { kind: 'archiveInspectionReport' }
}
export type InspectionErrorCode =
	| 'fileReadFailed'
	| 'passwordReadFailed'
	| 'profileValidationFailed'
	| 'invalidInspectorConfiguration'
	| 'inspectionFailed'
export class ArchiveInspectionError extends Error {
	constructor(readonly code: InspectionErrorCode) {
		super(code)
		this.name = 'ArchiveInspectionError'
	}
}
export type ArchiveInspectionResult =
	| { outcome: InspectionValidation; report: ArchiveInspectionReport }
	| { outcome: 'passwordRequired' | 'cancelled' | 'closed' }
	| { outcome: 'failed'; code: InspectionErrorCode | EnvelopeErrorCode | ArchivePayloadErrorCode }

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new ArchiveInspectionError('inspectionFailed')
	return value
}
class Report implements ArchiveInspectionReport {
	#summary: ArchiveInspectionSummary | undefined
	constructor(summary: ArchiveInspectionSummary) {
		this.#summary = summary
		Object.freeze(this)
	}
	readSummary() {
		return required(this.#summary)
	}
	release() {
		this.#summary = undefined
	}
	toJSON(): { kind: 'archiveInspectionReport' } {
		return { kind: 'archiveInspectionReport' }
	}
}
class Inspection {
	#source: ArchiveInspectionSource | undefined
	#passwordSource: ArchivePasswordSource | undefined
	#password: string | undefined
	#bytes: Uint8Array | undefined
	#envelope: ArchiveEnvelopeRequest | undefined
	#checked: IntegrityCheckedArchive | undefined
	#report: ArchiveInspectionReport | undefined
	#profiles: readonly ArchiveProfileValidator[]
	#matched: ArchiveProfileValidator | undefined
	#abort = new AbortController()
	#claimed = false
	#released = false
	#protection: 'none' | 'password' = 'none'
	readonly limits
	constructor(
		source: ArchiveInspectionSource,
		password: ArchivePasswordSource | undefined,
		profiles: readonly ArchiveProfileValidator[],
		limits: PayloadLimitOverrides
	) {
		this.#source = source
		this.#passwordSource = password
		this.#profiles = profiles
		this.limits = resolvePayloadLimits(limits)
	}
	#open() {
		if (this.#released) throw new ArchiveInspectionError('inspectionFailed')
	}
	claim() {
		this.#open()
		if (this.#claimed) throw new ArchiveInspectionError('inspectionFailed')
		this.#claimed = true
	}
	readSource(): Promise<'plain' | 'password' | 'passwordRequired'> {
		this.#open()
		return Promise.resolve()
			.then(() => {
				this.#open()
				return required(this.#source).read(this.#abort.signal, envelopeBytesLimit)
			})
			.then((bytes) => {
				try {
					this.#open()
					if (!(bytes instanceof Uint8Array) || bytes.byteLength > envelopeBytesLimit)
						throw new ArchivePayloadError('limitExceeded')
					this.#protection = parseEnvelope(bytes, this.limits).protection
					this.#bytes = bytes
					return this.#protection === 'none'
						? 'plain'
						: this.#passwordSource
							? 'password'
							: 'passwordRequired'
				} catch (error) {
					if (bytes instanceof Uint8Array) bytes.fill(0)
					throw error
				}
			})
			.catch((error: unknown) => {
				if (
					error instanceof ArchivePayloadError ||
					error instanceof ArchiveInspectionError ||
					error instanceof ArchiveEnvelopeError
				)
					throw error
				throw new ArchiveInspectionError('fileReadFailed')
			})
	}
	readPassword(): Promise<void> {
		this.#open()
		return Promise.resolve()
			.then(() => {
				this.#open()
				return required(this.#passwordSource).read(this.#abort.signal)
			})
			.then((password) => {
				this.#open()
				this.#password = password
			})
			.catch(() => {
				throw new ArchiveInspectionError('passwordReadFailed')
			})
	}
	envelopeRequest(): ArchiveEnvelopeRequest {
		this.#open()
		if (!this.#envelope) {
			this.#envelope = prepareArchiveOpen(required(this.#bytes), this.#password, this.limits)
			envelopeOperation(this.#envelope).retainCheckedOutput((archive) => {
				if (this.#released) archive.release()
				else this.#checked = archive
			})
			this.#bytes?.fill(0)
			this.#bytes = undefined
			this.#password = undefined
		}
		return this.#envelope
	}
	acceptOpened(result: ArchiveEnvelopeResult) {
		if (result.outcome === 'integrityChecked') {
			if (this.#released) result.archive.release()
			else this.#checked = result.archive
		}
	}
	matchProfile(): boolean {
		this.#open()
		const profile = required(this.#checked).readPayload().profile
		this.#matched = this.#profiles.find(
			(candidate) => candidate.id === profile.id && candidate.version === profile.version
		)
		return this.#matched !== undefined
	}
	validateProfile(): InspectionValidation {
		this.#open()
		try {
			const result: unknown = required(this.#matched).validate(
				required(this.#checked).readPayload()
			)
			if (typeof result !== 'boolean') throw new ArchiveInspectionError('profileValidationFailed')
			return result ? 'profileValid' : 'profileInvalid'
		} catch {
			throw new ArchiveInspectionError('profileValidationFailed')
		}
	}
	makeReport(): ArchiveInspectionReport {
		this.#open()
		const checked = required(this.#checked),
			payload = checked.readPayload()
		this.#report = new Report(
			Object.freeze({
				archiveId: payload.archiveId,
				profile: payload.profile,
				declaredSource: payload.source,
				protection: this.#protection,
				payloadSha256: checked.payloadDigest(),
				records: payload.records.length,
				references: payload.references.length,
				attachments: payload.attachments.length,
				attachmentBytes: payload.attachments.reduce((total, file) => total + file.sizeBytes, 0)
			})
		)
		return this.#report
	}
	abortRead() {
		this.#abort.abort()
	}
	cleanup(keepReport: boolean) {
		if (keepReport) this.#report = undefined
		this.release()
	}
	release() {
		this.#released = true
		this.#abort.abort()
		this.#bytes?.fill(0)
		this.#bytes = undefined
		this.#envelope?.release()
		this.#envelope = undefined
		this.#checked?.release()
		this.#checked = undefined
		this.#report?.release()
		this.#report = undefined
		this.#password = undefined
		this.#passwordSource = undefined
		this.#source = undefined
		this.#profiles = []
		this.#matched = undefined
	}
}
const inspections = new WeakMap<ArchiveInspectionRequest, Inspection>()
export function inspectionOperation(request: ArchiveInspectionRequest) {
	return required(inspections.get(request))
}
export function prepareArchiveInspection(options: {
	source: ArchiveInspectionSource
	password?: ArchivePasswordSource
	profiles?: readonly ArchiveProfileValidator[]
	limits?: PayloadLimitOverrides
}): ArchiveInspectionRequest {
	const profiles = options.profiles ?? []
	const schema = z.strictObject({ id: z.string().min(1).max(256), version: z.int().positive() })
	const known = new Map<string, Set<number>>()
	for (const profile of profiles) {
		if (
			!schema.safeParse({ id: profile.id, version: profile.version }).success ||
			typeof profile.validate !== 'function'
		)
			throw new ArchiveInspectionError('invalidInspectorConfiguration')
		const versions = known.get(profile.id) ?? new Set<number>()
		if (versions.has(profile.version))
			throw new ArchiveInspectionError('invalidInspectorConfiguration')
		versions.add(profile.version)
		known.set(profile.id, versions)
	}
	const operation = new Inspection(
		options.source,
		options.password,
		profiles.map((profile) => Object.freeze({ ...profile })),
		options.limits ?? {}
	)
	const request: ArchiveInspectionRequest = Object.freeze({
		release: () => operation.release(),
		toJSON: (): { kind: 'archiveInspectionRequest' } => ({ kind: 'archiveInspectionRequest' })
	})
	inspections.set(request, operation)
	return request
}
export function inspectionFailure(error: unknown): ArchiveInspectionResult {
	if (
		error instanceof ArchiveInspectionError ||
		error instanceof ArchivePayloadError ||
		error instanceof ArchiveEnvelopeError
	)
		return { outcome: 'failed', code: error.code }
	return { outcome: 'failed', code: 'inspectionFailed' }
}
