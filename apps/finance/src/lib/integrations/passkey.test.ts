import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
	createPasskey,
	encode,
	encryptPasskeySample,
	unlockCredential,
	verifyPasskeySample
} from './passkey.js'
import type { BankTrace } from './diagnostics.js'

vi.mock('./diagnostics.js', () => ({}))

const scope = {
	ownerId: '00000000-0000-4000-8000-000000000001',
	organizationId: '00000000-0000-4000-8000-000000000002',
	connectionId: '00000000-0000-4000-8000-000000000003'
}
const trace: BankTrace = {
	id: scope.connectionId,
	log: () => {},
	failed: () => {},
	step: async (_stage, work) => await work()
}
let output: ArrayBuffer = new ArrayBuffer(32)
class Credential {
	rawId = new Uint8Array([1, 2, 3]).buffer
	getClientExtensionResults() {
		return { prf: { enabled: true, results: { first: output } } }
	}
}
const create = vi.fn(async () => new Credential())
const get = vi.fn(async () => new Credential())
const signal = () => new AbortController().signal

beforeEach(() => {
	output = new Uint8Array(32).fill(7).buffer
	vi.stubGlobal('PublicKeyCredential', Credential)
	vi.stubGlobal('isSecureContext', true)
	vi.stubGlobal('navigator', { credentials: { create, get } })
	create.mockClear()
	get.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

async function sample() {
	const passkey = await createPasskey(scope, signal(), 'Test', trace)
	return encryptPasskeySample(scope, passkey, signal(), trace)
}
// Each WebAuthn assertion returns fresh PRF bytes; the implementation wipes them.
function freshAssertions() {
	get.mockImplementation(async () => {
		output = new Uint8Array(32).fill(7).buffer
		return new Credential()
	})
}

describe('passkey-protected credentials', () => {
	it('proves a round trip before sealing, encrypts the URL, and prompts on every unlock', async () => {
		freshAssertions()
		const encryptedSample = await sample()
		expect(get).toHaveBeenCalledTimes(1)
		const seal = await verifyPasskeySample(scope, encryptedSample, signal(), trace)
		expect(get).toHaveBeenCalledTimes(2)
		const url = 'https://user:secret@bridge.simplefin.org/simplefin'
		const envelope = await seal(url, signal())
		expect(JSON.stringify(envelope)).not.toContain('secret')
		expect(await unlockCredential(envelope, scope, signal(), trace)).toBe(url)
		expect(await unlockCredential(envelope, scope, signal(), trace)).toBe(url)
		expect(get).toHaveBeenCalledTimes(4)
		expect(new Uint8Array(output).every((byte) => byte === 0)).toBe(true)
	})

	it.each(['ownerId', 'organizationId', 'connectionId'])(
		'rejects a different %s before prompting',
		async (field) => {
			freshAssertions()
			const seal = await verifyPasskeySample(scope, await sample(), signal(), trace)
			const envelope = await seal('secret', signal())
			get.mockClear()
			await expect(
				unlockCredential(envelope, { ...scope, [field]: crypto.randomUUID() }, signal(), trace)
			).rejects.toThrow('invalid-credential')
			expect(get).not.toHaveBeenCalled()
		}
	)

	it('rejects changed ciphertext and a different PRF secret', async () => {
		freshAssertions()
		const encryptedSample = await sample()
		get.mockImplementation(async () => {
			output = new Uint8Array(32).fill(9).buffer
			return new Credential()
		})
		await expect(verifyPasskeySample(scope, encryptedSample, signal(), trace)).rejects.toThrow()
		freshAssertions()
		const seal = await verifyPasskeySample(scope, encryptedSample, signal(), trace)
		const envelope = await seal('secret', signal())
		await expect(
			unlockCredential(
				{ ...envelope, ciphertext: encode(new Uint8Array(32)) },
				scope,
				signal(),
				trace
			)
		).rejects.toThrow()
	})

	it('rejects missing PRF output and cancellation without falling back to plaintext', async () => {
		output = new ArrayBuffer(0)
		get.mockImplementation(async () => new Credential())
		await expect(sample()).rejects.toThrow('passkey-unavailable')
		const controller = new AbortController()
		controller.abort()
		get.mockClear()
		await expect(
			encryptPasskeySample(
				scope,
				{ credentialId: 'AQID', prfSalt: encode(new Uint8Array(32)) },
				controller.signal,
				trace
			)
		).rejects.toThrow()
		expect(get).not.toHaveBeenCalled()
	})

	it('handles foreign-realm buffers from password-manager extensions', async () => {
		const foreign: unknown = runInNewContext('new Uint8Array([1, 2, 3]).buffer')
		if (!foreign || typeof foreign !== 'object' || !('byteLength' in foreign))
			throw new Error('Invalid fixture')
		create.mockImplementationOnce(async () => {
			const credential = new Credential()
			Object.defineProperty(credential, 'rawId', { value: foreign })
			return credential
		})
		const descriptor = await createPasskey(scope, signal(), 'Test', trace)
		expect(descriptor.credentialId).toBe('AQID')
	})
})

it.each(['foreign-buffer', 'array-like'])(
	'accepts %s PRF output from password managers',
	async (kind) => {
		get.mockImplementation(async () => {
			const value: unknown =
				kind === 'foreign-buffer'
					? runInNewContext('new Uint8Array(32).fill(7).buffer')
					: Array.from({ length: 32 }, () => 7)
			const credential = new Credential()
			Object.defineProperty(credential, 'getClientExtensionResults', {
				value: () => ({ prf: { results: { first: value } } })
			})
			return credential
		})
		const encrypted = await sample()
		expect(await verifyPasskeySample(scope, encrypted, signal(), trace)).toBeTypeOf('function')
	}
)

it('rejects cancelled sealing and a different credential', async () => {
	freshAssertions()
	const seal = await verifyPasskeySample(scope, await sample(), signal(), trace)
	const controller = new AbortController()
	controller.abort()
	await expect(seal('secret', controller.signal)).rejects.toThrow()
	get.mockImplementation(async () => {
		const credential = new Credential()
		credential.rawId = new Uint8Array([9]).buffer
		return credential
	})
	await expect(sample()).rejects.toThrow('passkey-unavailable')
})
