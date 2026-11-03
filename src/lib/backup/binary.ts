import { ArchivePayloadError } from './types.js'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Validate alphabet, padding and pad bits and bound allocation before decoding. */
export function base64Size(value: string, maximum: number): number {
	if (value.length > Math.ceil(maximum / 3) * 4) throw new ArchivePayloadError('limitExceeded')
	if (value.length % 4 !== 0) throw new ArchivePayloadError('invalidPayload')
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
	const end = value.length - padding
	for (let index = 0; index < end; index += 1) {
		if (!alphabet.includes(value.charAt(index))) throw new ArchivePayloadError('invalidPayload')
	}
	const last = alphabet.indexOf(value.charAt(end - 1))
	if ((padding === 2 && last % 16 !== 0) || (padding === 1 && last % 4 !== 0))
		throw new ArchivePayloadError('invalidPayload')
	const size = (value.length / 4) * 3 - padding
	if (size > maximum) throw new ArchivePayloadError('limitExceeded')
	return size
}

export function decodeBase64(value: string, maximum: number): Uint8Array<ArrayBuffer> {
	const size = base64Size(value, maximum)
	const raw = atob(value)
	if (raw.length !== size) throw new ArchivePayloadError('invalidPayload')
	const result = new Uint8Array(size)
	for (let index = 0; index < size; index += 1) result[index] = raw.charCodeAt(index)
	return result
}

export function encodeBase64(bytes: Uint8Array): string {
	const parts: string[] = []
	for (let offset = 0; offset < bytes.length; offset += 32768)
		parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
	return btoa(parts.join(''))
}

export function hex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
