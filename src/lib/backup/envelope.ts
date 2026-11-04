import { z } from 'zod'
import { base64Size, decodeBase64, encodeBase64 } from './binary.js'
import { parsePayloadJson } from './json.js'
import { ArchivePayloadError, type PayloadLimits } from './types.js'

const utf8 = new TextEncoder()
export const envelopeBytesLimit = 64 * 1024 * 1024
const common = { magic: z.literal('DLF-BACKUP'), version: z.literal(1) }
const passwordHeader = z
	.strictObject({
		...common,
		protection: z.literal('password'),
		kdf: z.literal('PBKDF2-HMAC-SHA-256'),
		iterations: z.literal(600000),
		salt: z.string().length(24),
		cipher: z.literal('AES-256-GCM'),
		iv: z.string().length(16),
		tagBits: z.literal(128)
	})
	.readonly()
export type PasswordHeader = z.output<typeof passwordHeader>
export type Envelope = ReturnType<typeof parseEnvelope>
export type EnvelopeMode = 'sealPlain' | 'sealPassword' | 'openPlain' | 'openPassword'
export type EnvelopeErrorCode =
	| 'invalidEnvelope'
	| 'authenticationFailed'
	| 'integrityMismatch'
	| 'invalidPassword'
	| 'resourceReleased'
	| 'operationInUse'
	| 'cryptoFailed'
export function createArchiveEnvelopeError(code: EnvelopeErrorCode) {
	return Object.assign(new Error(code), { name: 'ArchiveEnvelopeError', code })
}
export function isArchiveEnvelopeError(
	error: unknown
): error is ReturnType<typeof createArchiveEnvelopeError> {
	return (
		error instanceof Error &&
		error.name === 'ArchiveEnvelopeError' &&
		'code' in error &&
		(error.code === 'invalidEnvelope' ||
			error.code === 'authenticationFailed' ||
			error.code === 'integrityMismatch' ||
			error.code === 'invalidPassword' ||
			error.code === 'resourceReleased' ||
			error.code === 'operationInUse' ||
			error.code === 'cryptoFailed')
	)
}

export function parseEnvelope(bytes: Uint8Array, limits: PayloadLimits) {
	if (bytes.byteLength > envelopeBytesLimit) throw new ArchivePayloadError('limitExceeded')
	let source: string
	try {
		source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
	} catch {
		throw new ArchivePayloadError('invalidEncoding')
	}
	if (source.charCodeAt(0) === 0xfeff) throw new ArchivePayloadError('invalidEncoding')
	const schema = z.discriminatedUnion('protection', [
		z
			.strictObject({
				...common,
				protection: z.literal('none'),
				payload: z.string().max(Math.ceil(limits.payloadBytes / 3) * 4),
				sha256: z.string().regex(/^[0-9a-f]{64}$/)
			})
			.readonly(),
		passwordHeader
			.unwrap()
			.extend({ payload: z.string().max(Math.ceil((limits.payloadBytes + 16) / 3) * 4) })
			.readonly()
	])
	const result = schema.safeParse(parsePayloadJson(source, { ...limits, depth: 4, jsonValues: 32 }))
	if (!result.success) throw createArchiveEnvelopeError('invalidEnvelope')
	const envelope = result.data
	if (envelope.protection === 'password') {
		if (
			base64Size(envelope.salt, 16) !== 16 ||
			base64Size(envelope.iv, 12) !== 12 ||
			base64Size(envelope.payload, limits.payloadBytes + 16) < 16
		)
			throw createArchiveEnvelopeError('invalidEnvelope')
	} else base64Size(envelope.payload, limits.payloadBytes)
	return envelope
}

export function newPasswordHeader(): PasswordHeader {
	return Object.freeze({
		magic: 'DLF-BACKUP',
		version: 1,
		protection: 'password',
		kdf: 'PBKDF2-HMAC-SHA-256',
		iterations: 600000,
		salt: encodeBase64(crypto.getRandomValues(new Uint8Array(16))),
		cipher: 'AES-256-GCM',
		iv: encodeBase64(crypto.getRandomValues(new Uint8Array(12))),
		tagBits: 128
	})
}

export function authenticatedHeader(header: PasswordHeader): Uint8Array<ArrayBuffer> {
	return utf8.encode(
		JSON.stringify([
			header.magic,
			header.version,
			header.protection,
			header.kdf,
			header.iterations,
			header.salt,
			header.cipher,
			header.iv,
			header.tagBits
		])
	)
}

export function gcmOptions(header: PasswordHeader): AesGcmParams {
	return {
		name: 'AES-GCM',
		iv: decodeBase64(header.iv, 12),
		additionalData: authenticatedHeader(header),
		tagLength: 128
	}
}

export function formatEnvelope(value: object): Uint8Array<ArrayBuffer> {
	const text = JSON.stringify(value)
	if (text.length > envelopeBytesLimit) throw new ArchivePayloadError('limitExceeded')
	const bytes = utf8.encode(text)
	if (bytes.length > envelopeBytesLimit) throw new ArchivePayloadError('limitExceeded')
	return bytes
}
