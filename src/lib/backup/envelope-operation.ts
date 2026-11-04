import { z } from 'zod'
import { encodeBase64 } from './binary.js'
import {
	createArchiveEnvelopeError,
	isArchiveEnvelopeError,
	envelopeBytesLimit,
	formatEnvelope,
	type EnvelopeErrorCode,
	type EnvelopeMode,
	type Envelope,
	type PasswordHeader
} from './envelope.js'
import { encodeArchivePayload } from './payload.js'
import {
	createArchivePayloadError,
	isArchivePayloadError,
	resolvePayloadLimits,
	type ArchivePayload,
	type ArchivePayloadErrorCode,
	type PayloadLimitOverrides,
	type PayloadLimits
} from './types.js'

export interface ArchiveEnvelopeRequest {
	/** Revoke input and request drain; native effects own their input copies until settlement. */
	release(): void
	toJSON(): { kind: 'archiveEnvelopeRequest' }
}
export interface SealedArchive {
	copyBytes(): Uint8Array<ArrayBuffer>
	release(): void
	toJSON(): { kind: 'sealedArchive' }
}
export interface IntegrityCheckedArchive {
	/** Structural/integrity checks only; no source coverage or restore authority. */
	readPayload(): ArchivePayload
	payloadDigest(): string
	copyPayloadBytes(): Uint8Array<ArrayBuffer>
	release(): void
	toJSON(): { kind: 'integrityCheckedArchive' }
}
export type EnvelopeSuccess =
	| { outcome: 'sealed'; archive: SealedArchive }
	| { outcome: 'integrityChecked'; archive: IntegrityCheckedArchive }
export type ArchiveEnvelopeResult =
	| EnvelopeSuccess
	| { outcome: 'cancelled' | 'closed' }
	| { outcome: 'failed'; code: EnvelopeErrorCode | ArchivePayloadErrorCode }
export type ArchiveProtection = { kind: 'none' } | { kind: 'password'; password: string }
export function requireEnvelopeValue<T>(value: T | undefined): T {
	if (value === undefined) throw createArchiveEnvelopeError('resourceReleased')
	return value
}
function createSealedArchive(input: Uint8Array<ArrayBuffer>): SealedArchive {
	let bytes: Uint8Array<ArrayBuffer> | undefined = input
	return Object.freeze({
		copyBytes: () => requireEnvelopeValue(bytes).slice(),
		release() {
			bytes?.fill(0)
			bytes = undefined
		},
		toJSON: (): { kind: 'sealedArchive' } => ({ kind: 'sealedArchive' })
	})
}
function createCheckedArchive(input: {
	payload: ArchivePayload
	bytes: Uint8Array<ArrayBuffer>
	digest: string
}): IntegrityCheckedArchive {
	let value: typeof input | undefined = input
	return Object.freeze({
		readPayload: () => requireEnvelopeValue(value).payload,
		payloadDigest: () => requireEnvelopeValue(value).digest,
		copyPayloadBytes: () => requireEnvelopeValue(value).bytes.slice(),
		release() {
			value?.bytes.fill(0)
			value = undefined
		},
		toJSON: (): { kind: 'integrityCheckedArchive' } => ({ kind: 'integrityCheckedArchive' })
	})
}
/** Private payload storage only; lifecycle, verification and iteration belong to the machine. */
type EnvelopeData = {
	initialMode: EnvelopeMode | undefined
	readonly limits: PayloadLimits
	bytes: Uint8Array<ArrayBuffer> | undefined
	file: Uint8Array<ArrayBuffer> | undefined
	parsedEnvelope: Envelope | undefined
	ciphertext: Uint8Array<ArrayBuffer> | undefined
	payload: ArchivePayload | undefined
	password: string | undefined
	material: CryptoKey | undefined
	key: CryptoKey | undefined
	header: PasswordHeader | undefined
	expectedDigest: string | undefined
	digest: string | undefined
	attachmentDigest: string | undefined
	output: EnvelopeSuccess | undefined
	checkedOwner: ((archive: IntegrityCheckedArchive) => void) | undefined
	sealedOwner: ((archive: SealedArchive) => void) | undefined
	releaseControl: (() => void) | undefined
}
type Prepared = {
	data: EnvelopeData
	claim(): void
	retainChecked(retain: (archive: IntegrityCheckedArchive) => void): void
	retainSealed(retain: (archive: SealedArchive) => void): void
}
const requests = new WeakMap<ArchiveEnvelopeRequest, Prepared>()
function prepared(request: ArchiveEnvelopeRequest) {
	return requireEnvelopeValue(requests.get(request))
}
export function envelopeData(request: ArchiveEnvelopeRequest) {
	return prepared(request).data
}
export function claimEnvelopeRequest(request: ArchiveEnvelopeRequest) {
	prepared(request).claim()
}
export function retainCheckedOutput(
	request: ArchiveEnvelopeRequest,
	retain: (archive: IntegrityCheckedArchive) => void
) {
	prepared(request).retainChecked(retain)
}
export function retainSealedOutput(
	request: ArchiveEnvelopeRequest,
	retain: (archive: SealedArchive) => void
) {
	prepared(request).retainSealed(retain)
}
/** One synchronous disposal/transfer leaf, called by the owning machine or native adapter teardown. */
export function clearEnvelopeData(request: ArchiveEnvelopeRequest, keepOutput = false) {
	const data = envelopeData(request)
	if (keepOutput) data.output = undefined
	data.file?.fill(0)
	data.bytes?.fill(0)
	data.ciphertext?.fill(0)
	data.output?.archive.release()
	data.initialMode = undefined
	data.file = undefined
	data.parsedEnvelope = undefined
	data.bytes = undefined
	data.ciphertext = undefined
	data.payload = undefined
	data.password = undefined
	data.material = undefined
	data.key = undefined
	data.header = undefined
	data.expectedDigest = undefined
	data.digest = undefined
	data.attachmentDigest = undefined
	data.output = undefined
	data.checkedOwner = undefined
	data.sealedOwner = undefined
}
/** Construction only. The machine determines when verification permits this operation. */
export function buildSealedArchive(
	request: ArchiveEnvelopeRequest,
	mode: EnvelopeMode
): EnvelopeSuccess {
	const data = envelopeData(request)
	requireEnvelopeValue(data.initialMode)
	const bytes =
		mode === 'sealPassword'
			? formatEnvelope({
					...requireEnvelopeValue(data.header),
					payload: encodeBase64(requireEnvelopeValue(data.ciphertext))
				})
			: formatEnvelope({
					magic: 'DLF-BACKUP',
					version: 1,
					protection: 'none',
					payload: encodeBase64(requireEnvelopeValue(data.bytes)),
					sha256: requireEnvelopeValue(data.digest)
				})
	const archive = createSealedArchive(bytes)
	data.output = { outcome: 'sealed', archive }
	data.sealedOwner?.(archive)
	return data.output
}
export function buildCheckedArchive(request: ArchiveEnvelopeRequest): EnvelopeSuccess {
	const data = envelopeData(request)
	requireEnvelopeValue(data.initialMode)
	const archive = createCheckedArchive({
		payload: requireEnvelopeValue(data.payload),
		bytes: requireEnvelopeValue(data.bytes),
		digest: requireEnvelopeValue(data.digest)
	})
	data.bytes = undefined
	data.output = { outcome: 'integrityChecked', archive }
	data.checkedOwner?.(archive)
	return data.output
}
function prepare(
	mode: EnvelopeMode,
	bytes: Uint8Array<ArrayBuffer>,
	password: string | undefined,
	limits: PayloadLimits
): ArchiveEnvelopeRequest {
	const data: EnvelopeData = {
		initialMode: mode,
		limits,
		bytes: mode.startsWith('seal') ? bytes : undefined,
		file: mode.startsWith('open') ? bytes : undefined,
		parsedEnvelope: undefined,
		ciphertext: undefined,
		payload: undefined,
		password,
		material: undefined,
		key: undefined,
		header: undefined,
		expectedDigest: undefined,
		digest: undefined,
		attachmentDigest: undefined,
		output: undefined,
		checkedOwner: undefined,
		sealedOwner: undefined,
		releaseControl: undefined
	}
	let available: EnvelopeData | undefined = data
	const request: ArchiveEnvelopeRequest = Object.freeze({
		release() {
			if (data.initialMode === undefined) return
			data.initialMode = undefined
			if (data.releaseControl) data.releaseControl()
			else clearEnvelopeData(request)
		},
		toJSON: (): { kind: 'archiveEnvelopeRequest' } => ({ kind: 'archiveEnvelopeRequest' })
	})
	requests.set(request, {
		data,
		claim() {
			requireEnvelopeValue(data.initialMode)
			if (!available) throw createArchiveEnvelopeError('operationInUse')
			available = undefined
		},
		retainChecked(retain) {
			requireEnvelopeValue(data.initialMode)
			if (!available || data.checkedOwner || !mode.startsWith('open'))
				throw createArchiveEnvelopeError('operationInUse')
			data.checkedOwner = retain
		},
		retainSealed(retain) {
			requireEnvelopeValue(data.initialMode)
			if (!available || data.sealedOwner || !mode.startsWith('seal'))
				throw createArchiveEnvelopeError('operationInUse')
			data.sealedOwner = retain
		}
	})
	return request
}
export function prepareArchiveSeal(
	payload: unknown,
	protection: ArchiveProtection,
	overrides: PayloadLimitOverrides = {}
): ArchiveEnvelopeRequest {
	const choice = z
		.discriminatedUnion('kind', [
			z.strictObject({ kind: z.literal('none') }),
			z.strictObject({ kind: z.literal('password'), password: z.string() })
		])
		.safeParse(protection)
	if (!choice.success) throw createArchiveEnvelopeError('invalidPassword')
	const limits = resolvePayloadLimits(overrides)
	return prepare(
		choice.data.kind === 'password' ? 'sealPassword' : 'sealPlain',
		encodeArchivePayload(payload, limits),
		choice.data.kind === 'password' ? choice.data.password : undefined,
		limits
	)
}
export function prepareArchiveOpen(
	bytes: Uint8Array,
	password?: string,
	overrides: PayloadLimitOverrides = {}
): ArchiveEnvelopeRequest {
	if (bytes.byteLength > envelopeBytesLimit) throw createArchivePayloadError('limitExceeded')
	return prepare('openPlain', Uint8Array.from(bytes), password, resolvePayloadLimits(overrides))
}
export function envelopeFailure(
	error: unknown
): Extract<ArchiveEnvelopeResult, { outcome: 'failed' }> {
	return isArchiveEnvelopeError(error) || isArchivePayloadError(error)
		? { outcome: 'failed', code: error.code }
		: { outcome: 'failed', code: 'cryptoFailed' }
}
