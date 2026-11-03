import { createPayloadSchemas } from './schemas.js'
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
	type IntegrityCheckedArchive
} from './envelope-operation.js'
import {
	ArchivePayloadError,
	resolvePayloadLimits,
	type ArchivePayload,
	type ArchivePayloadErrorCode,
	type PayloadLimitOverrides,
	type PayloadLimits
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
	#abort = new AbortController()
	#claimed = false
	#released = false
	#protection: 'none' | 'password' = 'none'
	readonly limits
	constructor(
		source: ArchiveInspectionSource,
		password: ArchivePasswordSource | undefined,
		profiles: readonly ArchiveProfileValidator[],
		limits: PayloadLimits
	) {
		this.#source = source
		this.#passwordSource = password
		this.#profiles = profiles
		this.limits = limits
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
	prepareEnvelope(): ArchiveEnvelopeRequest {
		this.#open()
		const request = prepareArchiveOpen(required(this.#bytes), this.#password, this.limits)
		this.#envelope = request
		// buildChecked is synchronous and rejects released envelope requests before calling this hook.
		envelopeOperation(request).retainCheckedOutput((archive) => {
			this.#checked = archive
		})
		this.#bytes?.fill(0)
		this.#bytes = undefined
		this.#password = undefined
		return request
	}
	inspectProfile(): ArchiveInspectionResult {
		this.#open()
		const payload = required(this.#checked).readPayload()
		const matched = this.#profiles.find(
			(candidate) =>
				candidate.id === payload.profile.id && candidate.version === payload.profile.version
		)
		let outcome: InspectionValidation = 'integrityValidProfileUnsupported'
		if (matched) {
			try {
				const valid: unknown = matched.validate(payload)
				if (typeof valid !== 'boolean') throw new ArchiveInspectionError('profileValidationFailed')
				outcome = valid ? 'profileValid' : 'profileInvalid'
			} catch {
				throw new ArchiveInspectionError('profileValidationFailed')
			}
		}
		return { outcome, report: this.#makeReport() }
	}
	#makeReport(): ArchiveInspectionReport {
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
	const limits = resolvePayloadLimits(options.limits)
	const schema = createPayloadSchemas(limits).payload.unwrap().shape.profile
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
		limits
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
