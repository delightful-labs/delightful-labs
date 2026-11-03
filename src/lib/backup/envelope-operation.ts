import { z } from 'zod'
import { decodeBase64, encodeBase64, hex } from './binary.js'
import {
	ArchiveEnvelopeError,
	envelopeBytesLimit,
	formatEnvelope,
	gcmOptions,
	newPasswordHeader,
	parseEnvelope,
	type EnvelopeErrorCode,
	type EnvelopeMode,
	type PasswordHeader
} from './envelope.js'
import { encodeArchivePayload, parseArchivePayload } from './payload.js'
import { wellFormed } from './schemas.js'
import {
	ArchivePayloadError,
	resolvePayloadLimits,
	type ArchivePayload,
	type ArchivePayloadErrorCode,
	type PayloadLimitOverrides,
	type PayloadLimits
} from './types.js'

export interface ArchiveEnvelopeRequest {
	/** Abrupt teardown fallback; native work drains before its owned data is cleared. */
	release(): void
	toJSON(): { kind: 'archiveEnvelopeRequest' }
}
export interface SealedArchive {
	copyBytes(): Uint8Array<ArrayBuffer>
	release(): void
	toJSON(): { kind: 'sealedArchive' }
}
export interface IntegrityCheckedArchive {
	/** Structural/integrity checks only; this grants no source coverage or restore authority. */
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

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new ArchiveEnvelopeError('resourceReleased')
	return value
}
class SealedResource implements SealedArchive {
	#bytes: Uint8Array<ArrayBuffer> | undefined
	constructor(bytes: Uint8Array<ArrayBuffer>) {
		this.#bytes = bytes
		Object.freeze(this)
	}
	copyBytes() {
		return required(this.#bytes).slice()
	}
	release() {
		this.#bytes?.fill(0)
		this.#bytes = undefined
	}
	toJSON(): { kind: 'sealedArchive' } {
		return { kind: 'sealedArchive' }
	}
}
class CheckedResource implements IntegrityCheckedArchive {
	#payload: ArchivePayload | undefined
	#bytes: Uint8Array<ArrayBuffer> | undefined
	#digest: string | undefined
	constructor(payload: ArchivePayload, bytes: Uint8Array<ArrayBuffer>, digest: string) {
		this.#payload = payload
		this.#bytes = bytes
		this.#digest = digest
		Object.freeze(this)
	}
	readPayload() {
		return required(this.#payload)
	}
	payloadDigest() {
		return required(this.#digest)
	}
	copyPayloadBytes() {
		return required(this.#bytes).slice()
	}
	release() {
		this.#bytes?.fill(0)
		this.#bytes = undefined
		this.#payload = undefined
		this.#digest = undefined
	}
	toJSON(): { kind: 'integrityCheckedArchive' } {
		return { kind: 'integrityCheckedArchive' }
	}
}

/** Per-operation private storage, never copied into actor context or invocation output. */
class Operation {
	#bytes: Uint8Array<ArrayBuffer> | undefined
	#file: Uint8Array<ArrayBuffer> | undefined
	#ciphertext: Uint8Array<ArrayBuffer> | undefined
	#payload: ArchivePayload | undefined
	#password: string | undefined
	#material: CryptoKey | undefined
	#key: CryptoKey | undefined
	#header: PasswordHeader | undefined
	#expectedDigest: string | undefined
	#digest: string | undefined
	#output: EnvelopeSuccess | undefined
	#checkedOwner: ((archive: IntegrityCheckedArchive) => void) | undefined
	#sealedOwner: ((archive: SealedArchive) => void) | undefined
	#cursor = 0
	#pending = 0
	#released = false
	#claimed = false
	mode: EnvelopeMode
	readonly limits: PayloadLimits
	constructor(
		mode: EnvelopeMode,
		bytes: Uint8Array<ArrayBuffer>,
		password: string | undefined,
		limits: PayloadLimits
	) {
		this.mode = mode
		this.limits = limits
		this.#password = password
		if (mode.startsWith('seal')) this.#bytes = bytes
		else this.#file = bytes
	}
	#open() {
		if (this.#released) throw new ArchiveEnvelopeError('resourceReleased')
	}
	claim() {
		this.#open()
		if (this.#claimed) throw new ArchiveEnvelopeError('operationInUse')
		this.#claimed = true
	}
	/** Internal ownership hook: a parent retains a child's acquired result before its done event. */
	retainCheckedOutput(retain: (archive: IntegrityCheckedArchive) => void) {
		this.#open()
		if (this.#claimed || this.#checkedOwner || !this.mode.startsWith('open'))
			throw new ArchiveEnvelopeError('operationInUse')
		this.#checkedOwner = retain
	}
	/** Internal parent ownership hook, before the sealing child's done event can be discarded. */
	retainSealedOutput(retain: (archive: SealedArchive) => void) {
		this.#open()
		if (this.#claimed || this.#sealedOwner || !this.mode.startsWith('seal'))
			throw new ArchiveEnvelopeError('operationInUse')
		this.#sealedOwner = retain
	}

	prepare(): EnvelopeMode {
		this.#open()
		if (this.mode.startsWith('seal')) {
			this.#payload = parseArchivePayload(required(this.#bytes), this.limits)
			if (this.mode === 'sealPassword') this.#header = newPasswordHeader()
		} else {
			const envelope = parseEnvelope(required(this.#file), this.limits)
			if (envelope.protection === 'password') {
				const { payload, ...header } = envelope
				this.mode = 'openPassword'
				this.#header = Object.freeze(header)
				this.#ciphertext = decodeBase64(payload, this.limits.payloadBytes + 16)
			} else {
				this.mode = 'openPlain'
				this.#expectedDigest = envelope.sha256
				this.#bytes = decodeBase64(envelope.payload, this.limits.payloadBytes)
			}
			this.#file?.fill(0)
			this.#file = undefined
		}
		return this.mode
	}
	/** Own exactly one native promise; released requests discard late results and drain cleanup. */
	#track<T>(promise: Promise<T>, accept: (value: T) => void): Promise<void> {
		this.#pending += 1
		return promise
			.then((value) => {
				if (this.#released) {
					if (value instanceof ArrayBuffer) new Uint8Array(value).fill(0)
					throw new ArchiveEnvelopeError('resourceReleased')
				}
				accept(value)
			})
			.finally(() => {
				this.#pending -= 1
				if (this.#released) this.#clear()
			})
	}
	#bytesLeaf<T>(
		bytes: Uint8Array<ArrayBuffer>,
		issue: () => Promise<T>,
		accept: (value: T) => void
	): Promise<void> {
		try {
			return this.#track(issue(), accept).finally(() => bytes.fill(0))
		} catch (error) {
			bytes.fill(0)
			throw error
		}
	}

	importPassword(): Promise<void> {
		this.#open()
		const parsed = z.string().min(1).max(1024).refine(wellFormed).safeParse(this.#password)
		if (!parsed.success) throw new ArchiveEnvelopeError('invalidPassword')
		const bytes = new TextEncoder().encode(parsed.data)
		if (bytes.length > 1024) {
			bytes.fill(0)
			throw new ArchiveEnvelopeError('invalidPassword')
		}
		this.#password = undefined
		return this.#bytesLeaf(
			bytes,
			() => crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']),
			(key) => {
				this.#material = key
			}
		)
	}
	deriveKey(): Promise<void> {
		this.#open()
		const header = required(this.#header)
		return this.#track(
			crypto.subtle.deriveKey(
				{
					name: 'PBKDF2',
					hash: 'SHA-256',
					salt: decodeBase64(header.salt, 16),
					iterations: 600000
				},
				required(this.#material),
				{ name: 'AES-GCM', length: 256 },
				false,
				[this.mode === 'sealPassword' ? 'encrypt' : 'decrypt']
			),
			(key) => {
				this.#key = key
				this.#material = undefined
			}
		)
	}
	encrypt(): Promise<void> {
		this.#open()
		return this.#track(
			crypto.subtle.encrypt(
				gcmOptions(required(this.#header)),
				required(this.#key),
				required(this.#bytes)
			),
			(value) => {
				this.#ciphertext = new Uint8Array(value)
				this.#key = undefined
			}
		)
	}
	decrypt(): Promise<void> {
		this.#open()
		const promise = crypto.subtle.decrypt(
			gcmOptions(required(this.#header)),
			required(this.#key),
			required(this.#ciphertext)
		)
		return this.#track(promise, (value) => {
			this.#bytes = new Uint8Array(value)
			this.#key = undefined
			if (this.#bytes.length > this.limits.payloadBytes)
				throw new ArchivePayloadError('limitExceeded')
		}).catch((error: unknown) => {
			if (error instanceof DOMException && error.name === 'OperationError')
				throw new ArchiveEnvelopeError('authenticationFailed')
			throw error
		})
	}
	hashPayload(): Promise<void> {
		this.#open()
		return this.#track(crypto.subtle.digest('SHA-256', required(this.#bytes)), (value) => {
			this.#digest = hex(value)
			if (this.#expectedDigest !== undefined && this.#digest !== this.#expectedDigest)
				throw new ArchiveEnvelopeError('integrityMismatch')
		})
	}
	parsePayload() {
		this.#open()
		this.#payload = parseArchivePayload(required(this.#bytes), this.limits)
	}
	hasAttachment() {
		return !this.#released && this.#cursor < (this.#payload?.attachments.length ?? 0)
	}
	hashAttachment(): Promise<void> {
		this.#open()
		const attachment = required(required(this.#payload).attachments[this.#cursor])
		const bytes = decodeBase64(attachment.data, this.limits.attachmentBytes)
		return this.#bytesLeaf(
			bytes,
			() => crypto.subtle.digest('SHA-256', bytes),
			(value) => {
				if (hex(value) !== attachment.sha256) throw new ArchiveEnvelopeError('integrityMismatch')
				this.#cursor += 1
			}
		)
	}
	buildEnvelope(): EnvelopeSuccess {
		this.#open()
		const bytes =
			this.mode === 'sealPassword'
				? formatEnvelope({
						...required(this.#header),
						payload: encodeBase64(required(this.#ciphertext))
					})
				: formatEnvelope({
						magic: 'DLF-BACKUP',
						version: 1,
						protection: 'none',
						payload: encodeBase64(required(this.#bytes)),
						sha256: required(this.#digest)
					})
		this.#output = { outcome: 'sealed', archive: new SealedResource(bytes) }
		this.#sealedOwner?.(this.#output.archive)
		return this.#output
	}
	buildChecked(): EnvelopeSuccess {
		this.#open()
		this.#output = {
			outcome: 'integrityChecked',
			archive: new CheckedResource(
				required(this.#payload),
				required(this.#bytes),
				required(this.#digest)
			)
		}
		this.#bytes = undefined // ownership moves to result; undelivered result remains cleanup-owned
		this.#checkedOwner?.(this.#output.archive)
		return this.#output
	}
	cleanup(keepOutput: boolean) {
		if (keepOutput) this.#output = undefined
		this.release()
	}
	release() {
		this.#released = true
		if (this.#pending === 0) this.#clear()
	}
	#clear() {
		this.#file?.fill(0)
		this.#bytes?.fill(0)
		this.#ciphertext?.fill(0)
		this.#output?.archive.release()
		this.#file = undefined
		this.#bytes = undefined
		this.#ciphertext = undefined
		this.#output = undefined
		this.#payload = undefined
		this.#password = undefined
		this.#material = undefined
		this.#key = undefined
		this.#header = undefined
		this.#digest = undefined
		this.#expectedDigest = undefined
		this.#checkedOwner = undefined
		this.#sealedOwner = undefined
	}
}

const operations = new WeakMap<ArchiveEnvelopeRequest, Operation>()
function request(operation: Operation): ArchiveEnvelopeRequest {
	const handle: ArchiveEnvelopeRequest = Object.freeze({
		release: () => operation.release(),
		toJSON: (): { kind: 'archiveEnvelopeRequest' } => ({ kind: 'archiveEnvelopeRequest' })
	})
	operations.set(handle, operation)
	return handle
}
/** Internal machine boundary; a caller cannot fabricate a request granting verified data. */
export function envelopeOperation(handle: ArchiveEnvelopeRequest) {
	return required(operations.get(handle))
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
	if (!choice.success) throw new ArchiveEnvelopeError('invalidPassword')
	const limits = resolvePayloadLimits(overrides)
	return request(
		new Operation(
			choice.data.kind === 'password' ? 'sealPassword' : 'sealPlain',
			encodeArchivePayload(payload, limits),
			choice.data.kind === 'password' ? choice.data.password : undefined,
			limits
		)
	)
}
export function prepareArchiveOpen(
	bytes: Uint8Array,
	password?: string,
	overrides: PayloadLimitOverrides = {}
): ArchiveEnvelopeRequest {
	if (bytes.byteLength > envelopeBytesLimit) throw new ArchivePayloadError('limitExceeded')
	return request(
		// Buffer.slice() is a shared view; always copy into an ordinary Uint8Array.
		new Operation('openPlain', Uint8Array.from(bytes), password, resolvePayloadLimits(overrides))
	)
}
export function envelopeFailure(error: unknown): ArchiveEnvelopeResult {
	if (error instanceof ArchiveEnvelopeError || error instanceof ArchivePayloadError)
		return { outcome: 'failed', code: error.code }
	return { outcome: 'failed', code: 'cryptoFailed' }
}
