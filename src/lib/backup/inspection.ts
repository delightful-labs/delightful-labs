import { createPayloadSchemas } from './schemas.js'
import {
	isArchiveEnvelopeError,
	parseEnvelope,
	envelopeBytesLimit,
	type EnvelopeErrorCode
} from './envelope.js'
import {
	retainCheckedOutput,
	prepareArchiveOpen,
	type ArchiveEnvelopeRequest,
	type IntegrityCheckedArchive
} from './envelope-operation.js'
import {
	createArchivePayloadError,
	isArchivePayloadError,
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
export function createArchiveInspectionError(code: InspectionErrorCode) {
	return Object.assign(new Error(code), { name: 'ArchiveInspectionError', code })
}
export function isArchiveInspectionError(
	error: unknown
): error is ReturnType<typeof createArchiveInspectionError> {
	return (
		error instanceof Error &&
		error.name === 'ArchiveInspectionError' &&
		'code' in error &&
		(error.code === 'fileReadFailed' ||
			error.code === 'passwordReadFailed' ||
			error.code === 'profileValidationFailed' ||
			error.code === 'invalidInspectorConfiguration' ||
			error.code === 'inspectionFailed')
	)
}
export type ArchiveInspectionResult =
	| { outcome: InspectionValidation; report: ArchiveInspectionReport }
	| { outcome: 'passwordRequired' | 'cancelled' | 'closed' }
	| { outcome: 'failed'; code: InspectionErrorCode | EnvelopeErrorCode | ArchivePayloadErrorCode }

export function requireInspectionValue<T>(value: T | undefined): T {
	if (value === undefined) throw createArchiveInspectionError('inspectionFailed')
	return value
}
function createInspectionReport(input: ArchiveInspectionSummary): ArchiveInspectionReport {
	let summary: ArchiveInspectionSummary | undefined = input
	return Object.freeze({
		readSummary: () => requireInspectionValue(summary),
		release() {
			summary = undefined
		},
		toJSON: (): { kind: 'archiveInspectionReport' } => ({ kind: 'archiveInspectionReport' })
	})
}
type InspectionInput = {
	source: ArchiveInspectionSource
	password: ArchivePasswordSource | undefined
	profiles: readonly ArchiveProfileValidator[]
}
/** Private payload references only. The chart owns stage, routing, interruption and transfer. */
type InspectionData = {
	input: InspectionInput | undefined
	readonly limits: PayloadLimits
	bytes: unknown
	password: string | undefined
	envelope: ArchiveEnvelopeRequest | undefined
	checked: IntegrityCheckedArchive | undefined
	report: ArchiveInspectionReport | undefined
	releaseControl: (() => void) | undefined
}
type PreparedInspection = { data: InspectionData; claim(): boolean }
const inspections = new WeakMap<ArchiveInspectionRequest, PreparedInspection>()
function prepared(request: ArchiveInspectionRequest) {
	return requireInspectionValue(inspections.get(request))
}
export function inspectionData(request: ArchiveInspectionRequest) {
	return prepared(request).data
}
export function claimInspectionRequest(request: ArchiveInspectionRequest) {
	return prepared(request).claim()
}
export function clearInspectionData(request: ArchiveInspectionRequest, keepReport = false) {
	const data = inspectionData(request)
	if (keepReport) data.report = undefined
	if (data.bytes instanceof Uint8Array) data.bytes.fill(0)
	data.bytes = undefined
	data.envelope?.release()
	data.envelope = undefined
	data.checked?.release()
	data.checked = undefined
	data.report?.release()
	data.report = undefined
	data.password = undefined
	data.input = undefined
}
function sourceBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array)) throw createArchivePayloadError('limitExceeded')
	return value
}
/** Pure bounded header check. Routing the observed protection belongs to the chart. */
export function inspectSourceHeader(request: ArchiveInspectionRequest): 'none' | 'password' {
	const data = inspectionData(request)
	const bytes = sourceBytes(data.bytes)
	if (bytes.byteLength > envelopeBytesLimit) throw createArchivePayloadError('limitExceeded')
	return parseEnvelope(bytes, data.limits).protection
}
/** Synchronous construction and early ownership registration, not an envelope workflow. */
export function prepareInspectionEnvelope(
	request: ArchiveInspectionRequest
): ArchiveEnvelopeRequest {
	const data = inspectionData(request)
	requireInspectionValue(data.input)
	const envelope = prepareArchiveOpen(sourceBytes(data.bytes), data.password, data.limits)
	data.envelope = envelope
	retainCheckedOutput(envelope, (archive) => {
		data.checked = archive
	})
	sourceBytes(data.bytes).fill(0)
	data.bytes = undefined
	data.password = undefined
	return envelope
}
export function matchInspectionProfile(request: ArchiveInspectionRequest): number {
	const data = inspectionData(request)
	const profile = requireInspectionValue(data.checked).readPayload().profile
	return requireInspectionValue(data.input).profiles.findIndex(
		(candidate) => candidate.id === profile.id && candidate.version === profile.version
	)
}
export function validateInspectionProfile(
	request: ArchiveInspectionRequest,
	index: number
): boolean {
	const data = inspectionData(request)
	const profile = requireInspectionValue(requireInspectionValue(data.input).profiles[index])
	try {
		const valid: unknown = profile.validate(requireInspectionValue(data.checked).readPayload())
		if (typeof valid !== 'boolean') throw createArchiveInspectionError('profileValidationFailed')
		return valid
	} catch {
		throw createArchiveInspectionError('profileValidationFailed')
	}
}
export function buildInspectionReport(
	request: ArchiveInspectionRequest,
	protection: 'none' | 'password'
): ArchiveInspectionReport {
	const data = inspectionData(request)
	requireInspectionValue(data.input)
	const checked = requireInspectionValue(data.checked)
	const payload = checked.readPayload()
	const report = createInspectionReport(
		Object.freeze({
			archiveId: payload.archiveId,
			profile: payload.profile,
			declaredSource: payload.source,
			protection,
			payloadSha256: checked.payloadDigest(),
			records: payload.records.length,
			references: payload.references.length,
			attachments: payload.attachments.length,
			attachmentBytes: payload.attachments.reduce((total, file) => total + file.sizeBytes, 0)
		})
	)
	data.report = report
	return report
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
			throw createArchiveInspectionError('invalidInspectorConfiguration')
		const versions = known.get(profile.id) ?? new Set<number>()
		if (versions.has(profile.version))
			throw createArchiveInspectionError('invalidInspectorConfiguration')
		versions.add(profile.version)
		known.set(profile.id, versions)
	}
	const input: InspectionInput = {
		source: options.source,
		password: options.password,
		profiles: profiles.map((profile) => Object.freeze({ ...profile }))
	}
	const data: InspectionData = {
		input,
		limits,
		bytes: undefined,
		password: undefined,
		envelope: undefined,
		checked: undefined,
		report: undefined,
		releaseControl: undefined
	}
	// Single-use admission consumes this reference; it does not track the running lifecycle.
	let available: InspectionInput | undefined = input
	const request: ArchiveInspectionRequest = Object.freeze({
		release() {
			if (data.input === undefined) return
			data.input = undefined
			available = undefined
			if (data.releaseControl) data.releaseControl()
			else clearInspectionData(request)
		},
		toJSON: (): { kind: 'archiveInspectionRequest' } => ({ kind: 'archiveInspectionRequest' })
	})
	inspections.set(request, {
		data,
		claim() {
			const current = requireInspectionValue(data.input)
			requireInspectionValue(available)
			available = undefined
			return current.password !== undefined
		}
	})
	return request
}
export function inspectionFailure(
	error: unknown,
	fallback: InspectionErrorCode = 'inspectionFailed'
): Extract<ArchiveInspectionResult, { outcome: 'failed' }> {
	if (
		isArchiveInspectionError(error) ||
		isArchivePayloadError(error) ||
		isArchiveEnvelopeError(error)
	)
		return { outcome: 'failed', code: error.code }
	return { outcome: 'failed', code: fallback }
}
