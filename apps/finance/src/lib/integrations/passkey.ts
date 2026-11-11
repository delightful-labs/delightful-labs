import { type BankTrace } from './diagnostics.js'
import {
	credentialEnvelopeSchema,
	type CredentialEnvelope,
	type CredentialScope
} from '../validation/integrations.js'

// isView recognizes views from other realms (including password-manager
// extensions). instanceof ArrayBuffer does not recognize foreign ArrayBuffers.
function byteView(value: ArrayBuffer | ArrayBufferView) {
	return ArrayBuffer.isView(value)
		? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
		: new Uint8Array(value)
}

export function encode(bytes: ArrayBuffer | Uint8Array) {
	return btoa(String.fromCharCode(...byteView(bytes)))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '')
}

function decode(value: string) {
	return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
		c.charCodeAt(0)
	)
}
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length))
const text = (value: string) => new TextEncoder().encode(value)

function binding(scope: CredentialScope, credentialId: string, salt: string) {
	return text(
		JSON.stringify([
			'simplefin',
			1,
			scope.ownerId,
			scope.organizationId,
			scope.connectionId,
			credentialId,
			salt
		])
	)
}

async function keyFor(
	credentialId: string,
	salt: string,
	scope: CredentialScope,
	signal: AbortSignal,
	trace: BankTrace
) {
	signal.throwIfAborted()
	const credential = await trace.step('passkey.assertion', () =>
		navigator.credentials.get({
			signal,
			publicKey: {
				challenge: random(32),
				allowCredentials: [{ type: 'public-key', id: decode(credentialId) }],
				userVerification: 'required',
				extensions: { prf: { eval: { first: decode(salt) } } }
			}
		})
	)
	const credentialMatched =
		credential instanceof PublicKeyCredential && encode(credential.rawId) === credentialId
	const output =
		credential instanceof PublicKeyCredential
			? credential.getClientExtensionResults().prf?.results?.first
			: undefined
	trace.log('passkey.assertion.result', { credentialMatched, prfResultPresent: Boolean(output) })
	if (!credentialMatched || !output) throw new Error('passkey-unavailable')
	const bytes = byteView(output)
	trace.log('passkey.prf.buffer', {
		prfByteLength: bytes.byteLength,
		prfSourceByteLength: output.byteLength,
		prfIsView: ArrayBuffer.isView(output),
		prfIsLocalArrayBuffer: output instanceof ArrayBuffer
	})
	if (bytes.byteLength !== 32) {
		bytes.fill(0)
		throw new Error('passkey-unavailable')
	}
	try {
		const material = await crypto.subtle.importKey('raw', new Uint8Array(bytes), 'HKDF', false, [
			'deriveKey'
		])
		return await crypto.subtle.deriveKey(
			{
				name: 'HKDF',
				hash: 'SHA-256',
				salt: decode(salt),
				info: binding(scope, credentialId, salt)
			},
			material,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		)
	} finally {
		bytes.fill(0)
	}
}

export type PasskeyDescriptor = { credentialId: string; prfSalt: string }
export type PasskeySample = {
	passkey: PasskeyDescriptor
	iv: Uint8Array<ArrayBuffer>
	ciphertext: ArrayBuffer
}
export type CredentialSealer = (
	accessUrl: string,
	signal: AbortSignal
) => Promise<CredentialEnvelope>

export async function createPasskey(
	scope: CredentialScope,
	signal: AbortSignal,
	appName: string,
	trace: BankTrace
) {
	trace.log('passkey.capabilities', {
		secureContext: globalThis.isSecureContext,
		webAuthnAvailable: Boolean(globalThis.PublicKeyCredential)
	})
	if (!globalThis.isSecureContext || !globalThis.PublicKeyCredential)
		throw new Error('passkey-unavailable')
	const created = await trace.step('passkey.create', () =>
		navigator.credentials.create({
			signal,
			publicKey: {
				challenge: random(32),
				rp: { name: appName },
				user: { id: text(scope.ownerId), name: scope.ownerId, displayName: appName },
				pubKeyCredParams: [
					{ type: 'public-key', alg: -7 },
					{ type: 'public-key', alg: -257 }
				],
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				attestation: 'none',
				extensions: { prf: {} }
			}
		})
	)
	trace.log('passkey.create.result', {
		prfEnabled:
			created instanceof PublicKeyCredential &&
			created.getClientExtensionResults().prf?.enabled === true
	})
	if (!(created instanceof PublicKeyCredential)) throw new Error('passkey-unavailable')
	return { credentialId: encode(created.rawId), prfSalt: encode(random(32)) }
}

export async function encryptPasskeySample(
	scope: CredentialScope,
	passkey: PasskeyDescriptor,
	signal: AbortSignal,
	trace: BankTrace,
	sampleText = 'Delightful Finance credential encryption check'
): Promise<PasskeySample> {
	const iv = random(12)
	const additionalData = binding(scope, passkey.credentialId, passkey.prfSalt)
	const key = await keyFor(passkey.credentialId, passkey.prfSalt, scope, signal, trace)
	const ciphertext = await trace.step('passkey.sample.encrypt', () =>
		crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, text(sampleText))
	)
	signal.throwIfAborted()
	return { passkey, iv, ciphertext }
}

// This closure holds a nonextractable key only until setup is saved or cancelled.
export async function verifyPasskeySample(
	scope: CredentialScope,
	sample: PasskeySample,
	signal: AbortSignal,
	trace: BankTrace,
	sampleText = 'Delightful Finance credential encryption check'
): Promise<CredentialSealer> {
	const { credentialId, prfSalt } = sample.passkey
	const additionalData = binding(scope, credentialId, prfSalt)
	const key = await keyFor(credentialId, prfSalt, scope, signal, trace)
	const recovered = await trace.step('passkey.sample.decrypt', () =>
		crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: sample.iv, additionalData },
			key,
			sample.ciphertext
		)
	)
	if (encode(recovered) !== encode(text(sampleText))) throw new Error('passkey-unavailable')
	signal.throwIfAborted()
	return async (accessUrl, operationSignal) => {
		operationSignal.throwIfAborted()
		const iv = random(12)
		const ciphertext = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv, additionalData },
			key,
			text(accessUrl)
		)
		operationSignal.throwIfAborted()
		return credentialEnvelopeSchema.parse({
			version: 1,
			...scope,
			credentialId,
			prfSalt,
			iv: encode(iv),
			ciphertext: encode(ciphertext)
		})
	}
}

export async function unlockCredential(
	input: unknown,
	scope: CredentialScope,
	signal: AbortSignal,
	trace: BankTrace
) {
	const envelope = await trace.step('credential.validate-envelope', () =>
		credentialEnvelopeSchema.parse(input)
	)
	if (
		envelope.ownerId !== scope.ownerId ||
		envelope.organizationId !== scope.organizationId ||
		envelope.connectionId !== scope.connectionId ||
		decode(envelope.iv).length !== 12 ||
		decode(envelope.prfSalt).length !== 32
	)
		throw new Error('invalid-credential')
	const key = await keyFor(envelope.credentialId, envelope.prfSalt, scope, signal, trace)
	const result = await trace.step('credential.decrypt', () =>
		crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: decode(envelope.iv),
				additionalData: binding(scope, envelope.credentialId, envelope.prfSalt)
			},
			key,
			decode(envelope.ciphertext)
		)
	)
	signal.throwIfAborted()
	const bytes = new Uint8Array(result)
	try {
		return new TextDecoder().decode(bytes)
	} finally {
		bytes.fill(0)
	}
}
