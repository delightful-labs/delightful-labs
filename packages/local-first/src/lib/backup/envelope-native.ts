import { createCallbackLogic } from 'xstate'
import { z } from 'zod'
import { wellFormed } from './schemas.js'
import { decodeBase64, hex } from './binary.js'
import { createArchiveEnvelopeError, gcmOptions } from './envelope.js'
import {
	clearEnvelopeData,
	envelopeData,
	envelopeFailure,
	requireEnvelopeValue,
	type ArchiveEnvelopeRequest,
	type ArchiveEnvelopeResult
} from './envelope-operation.js'

export type EnvelopeCryptoCommand =
	| { type: 'IMPORT_PASSWORD' }
	| { type: 'DERIVE_KEY'; usage: 'encrypt' | 'decrypt' }
	| { type: 'ENCRYPT' | 'DECRYPT' | 'HASH_PAYLOAD' }
	| { type: 'HASH_ATTACHMENT'; index: number }
export type EnvelopeCryptoEvent =
	| { type: 'CRYPTO_DONE' | 'RELEASE' }
	| { type: 'CRYPTO_FAILED'; failure: Extract<ArchiveEnvelopeResult, { outcome: 'failed' }> }

/** Native calls own their input copies until settlement. Disposal detaches reports, not WebCrypto. */
export const envelopeCrypto = createCallbackLogic<
	EnvelopeCryptoCommand,
	{ request: ArchiveEnvelopeRequest }
>(({ input, receive, sendBack }) => {
	const data = envelopeData(input.request)
	let report: ((event: EnvelopeCryptoEvent) => void) | undefined = sendBack
	const release = () => report?.({ type: 'RELEASE' })
	data.releaseControl = release
	function issue<T>(
		bytes: Uint8Array<ArrayBuffer>,
		run: () => Promise<T>,
		accept: (value: T) => void
	) {
		// Promise callbacks retain only this call's input; no capsule pending counter or drain protocol.
		void Promise.resolve()
			.then(run)
			.then((value) => {
				if (report) {
					accept(value)
					bytes.fill(0)
					report({ type: 'CRYPTO_DONE' })
				} else if (value instanceof ArrayBuffer) new Uint8Array(value).fill(0)
			})
			.catch((error) => {
				bytes.fill(0)
				report?.({ type: 'CRYPTO_FAILED', failure: envelopeFailure(error) })
			})
			.finally(() => bytes.fill(0))
	}
	receive((command) => {
		try {
			if (command.type === 'IMPORT_PASSWORD') {
				const password = z.string().min(1).max(1024).refine(wellFormed).safeParse(data.password)
				if (!password.success) throw createArchiveEnvelopeError('invalidPassword')
				const bytes = new TextEncoder().encode(password.data)
				data.password = undefined
				if (bytes.length > 1024) {
					bytes.fill(0)
					throw createArchiveEnvelopeError('invalidPassword')
				}
				issue(
					bytes,
					() => crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']),
					(value) => {
						data.material = value
					}
				)
			} else if (command.type === 'DERIVE_KEY') {
				const header = requireEnvelopeValue(data.header)
				const material = requireEnvelopeValue(data.material)
				const salt = decodeBase64(header.salt, 16)
				issue(
					salt,
					() =>
						crypto.subtle.deriveKey(
							{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: header.iterations },
							material,
							{ name: 'AES-GCM', length: 256 },
							false,
							[command.usage]
						),
					(value) => {
						data.key = value
					}
				)
			} else if (command.type === 'ENCRYPT' || command.type === 'DECRYPT') {
				const key = requireEnvelopeValue(data.key)
				const options = gcmOptions(requireEnvelopeValue(data.header))
				const bytes = requireEnvelopeValue(
					command.type === 'ENCRYPT' ? data.bytes : data.ciphertext
				).slice()
				issue(
					bytes,
					() =>
						command.type === 'ENCRYPT'
							? crypto.subtle.encrypt(options, key, bytes)
							: crypto.subtle.decrypt(options, key, bytes).catch((error) => {
									if (error instanceof DOMException && error.name === 'OperationError')
										throw createArchiveEnvelopeError('authenticationFailed')
									throw error
								}),
					(value) => {
						if (command.type === 'ENCRYPT') data.ciphertext = new Uint8Array(value)
						else data.bytes = new Uint8Array(value)
					}
				)
			} else {
				const bytes =
					command.type === 'HASH_ATTACHMENT'
						? decodeBase64(
								requireEnvelopeValue(requireEnvelopeValue(data.payload).attachments[command.index])
									.data,
								data.limits.attachmentBytes
							)
						: requireEnvelopeValue(data.bytes).slice()
				issue(
					bytes,
					() => crypto.subtle.digest('SHA-256', bytes),
					(value) => {
						const digest = hex(value)
						new Uint8Array(value).fill(0)
						if (command.type === 'HASH_ATTACHMENT') data.attachmentDigest = digest
						else data.digest = digest
					}
				)
			}
		} catch (error) {
			report?.({ type: 'CRYPTO_FAILED', failure: envelopeFailure(error) })
		}
	})
	return () => {
		report = undefined
		if (data.releaseControl === release) data.releaseControl = undefined
		clearEnvelopeData(input.request)
	}
})
