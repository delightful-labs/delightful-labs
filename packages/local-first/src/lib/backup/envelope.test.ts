import * as binary from './binary.js'
import vector from '../../../tests/fixtures/archive-envelope-v1.json'
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { encodeArchivePayload, type ArchivePayload } from './archive.js'
import {
	prepareArchiveOpen,
	prepareArchiveSeal,
	type ArchiveEnvelopeRequest,
	type ArchiveEnvelopeResult,
	type ArchiveProtection,
	type SealedArchive,
	type IntegrityCheckedArchive
} from './envelope-api.js'
import { createArchiveEnvelopeMachine } from '../machines/backup/envelope.js'
import { envelopeData } from './envelope-operation.js'

const utf8 = new TextEncoder()
function deferred<T>() {
	let resolve: (value: T | PromiseLike<T>) => void = () => {
		throw new Error('Uninitialized gate')
	}
	let reject: (reason: unknown) => void = () => {
		throw new Error('Uninitialized gate')
	}
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
const password = ' test-password-é😀 '
function sample(): ArchivePayload {
	return {
		archiveId: '12345678-1234-4234-8234-123456789abc',
		profile: { id: 'example.notes', version: 1 },
		source: { applicationId: 'app', workspaceId: 'private-workspace-sentinel' },
		capturedAt: '2026-11-03T00:00:00.000Z',
		coverage: {
			mode: 'complete-supported-graph',
			recordTypes: ['note'],
			history: 'current-data',
			deletedRecords: 'excluded',
			consistency: 'quiescent-single-user'
		},
		records: [
			{
				type: 'note',
				id: 'one',
				fields: {
					text: { kind: 'text', value: 'private-record-sentinel' },
					file: { kind: 'attachment', id: 'file' }
				}
			}
		],
		attachments: [
			{
				id: 'file',
				fileName: 'private-file-sentinel.txt',
				mediaType: 'text/plain',
				sizeBytes: 2,
				data: 'aGk=',
				sha256: createHash('sha256').update('hi').digest('hex')
			}
		],
		references: []
	}
}
function run(request: ArchiveEnvelopeRequest): Promise<ArchiveEnvelopeResult> {
	const actor = createActor(createArchiveEnvelopeMachine(), { input: { request } })
	actor.start()
	return toPromise(actor)
}
async function seal(protection: ArchiveProtection = { kind: 'none' }) {
	const result = await run(prepareArchiveSeal(sample(), protection))
	if (result.outcome !== 'sealed') throw new Error(JSON.stringify(result))
	const bytes = result.archive.copyBytes()
	result.archive.release()
	return bytes
}
function wire(value: unknown) {
	return utf8.encode(JSON.stringify(value))
}
const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
const iv = Buffer.from('101112131415161718191a1b', 'hex')
function header() {
	return {
		magic: 'DLF-BACKUP',
		version: 1,
		protection: 'password',
		kdf: 'PBKDF2-HMAC-SHA-256',
		iterations: 600000,
		salt: salt.toString('base64'),
		cipher: 'AES-256-GCM',
		iv: iv.toString('base64'),
		tagBits: 128
	}
}
function aad(saltText = salt.toString('base64'), ivText = iv.toString('base64')) {
	return Buffer.from(
		JSON.stringify([
			'DLF-BACKUP',
			1,
			'password',
			'PBKDF2-HMAC-SHA-256',
			600000,
			saltText,
			'AES-256-GCM',
			ivText,
			128
		])
	)
}
/** Independent Node crypto implementation and literal format, not the library's header helpers. */
function externalEncrypted(
	payload = Buffer.from(encodeArchivePayload(sample())),
	secret = password
) {
	const key = pbkdf2Sync(secret, salt, 600000, 32, 'sha256')
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	cipher.setAAD(aad())
	const body = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()])
	key.fill(0)
	return { ...header(), payload: body.toString('base64') }
}
function externalPlain(payload = Buffer.from(encodeArchivePayload(sample()))) {
	return {
		magic: 'DLF-BACKUP',
		version: 1,
		protection: 'none',
		payload: payload.toString('base64'),
		sha256: createHash('sha256').update(payload).digest('hex')
	}
}
afterEach(() => vi.restoreAllMocks())

describe('independent crypto compatibility', () => {
	it('opens the fixed external v1 vector with exact expected bytes and digest', async () => {
		const result = await run(prepareArchiveOpen(wire(vector.envelope), vector.password))
		if (result.outcome !== 'integrityChecked') throw new Error(JSON.stringify(result))
		expect(Buffer.from(result.archive.copyPayloadBytes()).toString('base64')).toBe(
			vector.payloadBase64
		)
		expect(result.archive.payloadDigest()).toBe(vector.payloadSha256)
		result.archive.release()
	})
	it('opens an independently encrypted PBKDF2/AES-GCM archive', async () => {
		const result = await run(prepareArchiveOpen(wire(externalEncrypted()), password))
		expect(result.outcome).toBe('integrityChecked')
		if (result.outcome !== 'integrityChecked') return
		expect(result.archive.readPayload()).toEqual(sample())
		expect(result.archive.payloadDigest()).toBe(
			createHash('sha256').update(result.archive.copyPayloadBytes()).digest('hex')
		)
		result.archive.release()
	})
	it('produces encrypted bytes independently decryptable using the documented tuple', async () => {
		const bytes = await seal({ kind: 'password', password })
		// Validate output shape with the test's fixed header keys, independently of the reader schema.
		const envelope: unknown = JSON.parse(new TextDecoder().decode(bytes))
		if (
			typeof envelope !== 'object' ||
			envelope === null ||
			!('salt' in envelope) ||
			typeof envelope.salt !== 'string' ||
			!('iv' in envelope) ||
			typeof envelope.iv !== 'string' ||
			!('payload' in envelope) ||
			typeof envelope.payload !== 'string'
		)
			throw new Error('Invalid output')
		const key = pbkdf2Sync(password, Buffer.from(envelope.salt, 'base64'), 600000, 32, 'sha256')
		const body = Buffer.from(envelope.payload, 'base64')
		const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
		decipher.setAAD(aad(envelope.salt, envelope.iv))
		decipher.setAuthTag(body.subarray(-16))
		const plain = Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()])
		expect(plain).toEqual(Buffer.from(encodeArchivePayload(sample())))
		key.fill(0)
		const text = new TextDecoder().decode(bytes)
		for (const secret of [
			password,
			'private-workspace-sentinel',
			'private-record-sentinel',
			'private-file-sentinel'
		])
			expect(text).not.toContain(secret)
	})
	it('opens plaintext without reserializing the bytes being hashed', async () => {
		const raw = Buffer.from(' \n' + JSON.stringify(sample()) + '\n')
		const result = await run(prepareArchiveOpen(wire(externalPlain(raw))))
		if (result.outcome !== 'integrityChecked') throw new Error(JSON.stringify(result))
		expect(result.archive.copyPayloadBytes()).toEqual(new Uint8Array(raw))
		expect(result.archive.payloadDigest()).toBe(createHash('sha256').update(raw).digest('hex'))
		result.archive.release()
	})
	it.each([{ kind: 'none' }, { kind: 'password', password }] satisfies ArchiveProtection[])(
		'round-trips $kind and releases result handles',
		async (protection) => {
			const bytes = await seal(protection)
			const opened = await run(prepareArchiveOpen(bytes, password))
			if (opened.outcome !== 'integrityChecked') throw new Error(JSON.stringify(opened))
			expect(opened.archive.readPayload()).toEqual(sample())
			const copy = opened.archive.copyPayloadBytes()
			copy.fill(0)
			expect(opened.archive.copyPayloadBytes()).not.toEqual(copy)
			expect(JSON.stringify(opened)).not.toContain('private-')
			opened.archive.release()
			opened.archive.release()
			expect(() => opened.archive.readPayload()).toThrow('resourceReleased')
			expect(() => opened.archive.payloadDigest()).toThrow('resourceReleased')
			expect(() => opened.archive.copyPayloadBytes()).toThrow('resourceReleased')
		}
	)
	it('generates fresh salt and IV on each seal', async () => {
		const first = await seal({ kind: 'password', password })
		const second = await seal({ kind: 'password', password })
		expect(first).not.toEqual(second)
		const one: unknown = JSON.parse(new TextDecoder().decode(first)),
			two: unknown = JSON.parse(new TextDecoder().decode(second))
		if (
			!one ||
			!two ||
			typeof one !== 'object' ||
			typeof two !== 'object' ||
			!('salt' in one) ||
			!('salt' in two) ||
			!('iv' in one) ||
			!('iv' in two)
		)
			throw new Error('Invalid output')
		expect(one.salt).not.toBe(two.salt)
		expect(one.iv).not.toBe(two.iv)
	})
})

describe('tampering, parameters and input bounds', () => {
	it('uses one authentication failure for wrong password and damaged ciphertext', async () => {
		const envelope = externalEncrypted()
		expect(await run(prepareArchiveOpen(wire(envelope), password.trim()))).toEqual({
			outcome: 'failed',
			code: 'authenticationFailed'
		})
		const body = Buffer.from(envelope.payload, 'base64')
		body[0] = (body[0] ?? 0) ^ 1
		expect(
			await run(
				prepareArchiveOpen(wire({ ...envelope, payload: body.toString('base64') }), password)
			)
		).toEqual({ outcome: 'failed', code: 'authenticationFailed' })
	})
	it.each(['salt', 'iv'])('authenticates valid-length changed %s', async (field) => {
		const envelope = externalEncrypted()
		const replacement = field === 'salt' ? Buffer.alloc(16, 9) : Buffer.alloc(12, 9)
		expect(
			await run(
				prepareArchiveOpen(wire({ ...envelope, [field]: replacement.toString('base64') }), password)
			)
		).toEqual({ outcome: 'failed', code: 'authenticationFailed' })
	})
	it.each([
		{ version: 2 },
		{ iterations: 1 },
		{ iterations: 600001 },
		{ cipher: 'AES-CBC' },
		{ tagBits: 96 },
		{ kdf: 'custom' },
		{ extra: 'value' },
		{ salt: 'AAAA' },
		{ iv: 'AAAA' }
	])('rejects unsupported headers before importing a password: %j', async (changes) => {
		const imported = vi.spyOn(crypto.subtle, 'importKey')
		const result = await run(
			prepareArchiveOpen(
				wire({ ...header(), payload: Buffer.alloc(16).toString('base64'), ...changes }),
				password
			)
		)
		expect(result.outcome).toBe('failed')
		expect(imported).not.toHaveBeenCalled()
	})
	it.each(['', '\ud800', 'x'.repeat(1025), '😀'.repeat(257)])(
		'rejects invalid password without native import',
		async (secret) => {
			const imported = vi.spyOn(crypto.subtle, 'importKey')
			expect(
				await run(prepareArchiveSeal(sample(), { kind: 'password', password: secret }))
			).toEqual({ outcome: 'failed', code: 'invalidPassword' })
			expect(imported).not.toHaveBeenCalled()
		}
	)
	it('refuses to seal or accept an archive with a wrong attachment digest', async () => {
		const input = {
			...sample(),
			attachments: sample().attachments.map((file) => ({ ...file, sha256: '0'.repeat(64) }))
		}
		expect(await run(prepareArchiveSeal(input, { kind: 'none' }))).toEqual({
			outcome: 'failed',
			code: 'integrityMismatch'
		})
		const plain = externalPlain(Buffer.from(encodeArchivePayload(input)))
		expect(await run(prepareArchiveOpen(wire(plain)))).toEqual({
			outcome: 'failed',
			code: 'integrityMismatch'
		})
	})
	it('detects plaintext corruption, malformed payloads and duplicate header keys', async () => {
		expect(
			await run(prepareArchiveOpen(wire({ ...externalPlain(), sha256: '0'.repeat(64) })))
		).toEqual({ outcome: 'failed', code: 'integrityMismatch' })
		expect((await run(prepareArchiveOpen(wire(externalPlain(Buffer.from('{}')))))).outcome).toBe(
			'failed'
		)
		expect(await run(prepareArchiveOpen(utf8.encode('{"version":1,"version":1}')))).toEqual({
			outcome: 'failed',
			code: 'duplicateKey'
		})
		expect(await run(prepareArchiveOpen(utf8.encode('\ufeff{}')))).toEqual({
			outcome: 'failed',
			code: 'invalidEncoding'
		})
	})
	it('checks file/ciphertext bounds before crypto and copies mutable caller buffers', async () => {
		expect(() => prepareArchiveOpen(new Uint8Array(64 * 1024 * 1024 + 1))).toThrow('limitExceeded')
		const imported = vi.spyOn(crypto.subtle, 'importKey')
		expect(
			(
				await run(
					prepareArchiveOpen(
						wire({ ...header(), payload: Buffer.alloc(18).toString('base64') }),
						password,
						{ payloadBytes: 1 }
					)
				)
			).outcome
		).toBe('failed')
		expect(imported).not.toHaveBeenCalled()
		const bytes = wire(externalPlain()),
			request = prepareArchiveOpen(bytes)
		bytes.fill(0)
		const result = await run(request)
		expect(result.outcome).toBe('integrityChecked')
		if (result.outcome === 'integrityChecked') result.archive.release()
	})
})

describe('operation ownership, interruption and safe snapshots', () => {
	it('does not claim an envelope merely by constructing an unstarted actor', async () => {
		const request = prepareArchiveSeal(sample(), { kind: 'none' })
		const dormant = createActor(createArchiveEnvelopeMachine(), { input: { request } })
		const active = createActor(createArchiveEnvelopeMachine(), { input: { request } }).start()
		dormant.start()
		expect(await toPromise(dormant)).toEqual({ outcome: 'failed', code: 'operationInUse' })
		const result = await toPromise(active)
		expect(result.outcome).toBe('sealed')
		if (result.outcome === 'sealed') result.archive.release()
	})
	it('detaches Node Buffer inputs instead of retaining Buffer.slice views', async () => {
		const input = Buffer.from(wire(externalPlain()))
		const request = prepareArchiveOpen(input)
		input.fill(0)
		const result = await run(request)
		expect(result.outcome).toBe('integrityChecked')
		if (result.outcome === 'integrityChecked') result.archive.release()
		const retained = Buffer.from(wire(externalPlain()))
		const before = Buffer.from(retained)
		prepareArchiveOpen(retained).release()
		expect(retained).toEqual(before)
	})
	it.each(['none', 'password'])(
		'keeps prepared %s graph and bytes independent of later caller mutation',
		async (kind) => {
			const input = sample(),
				record = input.records[0],
				attachment = input.attachments[0]
			if (!record || !attachment) throw new Error('Fixture missing')
			const mutableRecord = { ...record, fields: { ...record.fields } }
			const mutableAttachment = { ...attachment }
			const caller = { ...input, records: [mutableRecord], attachments: [mutableAttachment] }
			const expected = encodeArchivePayload(caller)
			const request = prepareArchiveSeal(
				caller,
				kind === 'password' ? { kind: 'password', password } : { kind: 'none' }
			)
			mutableRecord.fields.text = { kind: 'text', value: 'changed after preparation' }
			mutableAttachment.data = 'AA=='
			mutableAttachment.sizeBytes = 1
			caller.records.length = 0
			const sealed = await run(request)
			if (sealed.outcome !== 'sealed') throw new Error('Sealing failed')
			try {
				const opened = await run(
					prepareArchiveOpen(sealed.archive.copyBytes(), kind === 'password' ? password : undefined)
				)
				if (opened.outcome !== 'integrityChecked') throw new Error('Independent opening failed')
				try {
					expect(opened.archive.copyPayloadBytes()).toEqual(expected)
				} finally {
					opened.archive.release()
				}
			} finally {
				sealed.archive.release()
			}
		}
	)
	it('enforces the exact serialized byte bound when escaping expands source text', () => {
		const input = sample(),
			record = input.records[0]
		if (!record) throw new Error('Fixture missing')
		const payload = {
			...input,
			records: [
				{
					...record,
					fields: { ...record.fields, text: { kind: 'text', value: '\u0000'.repeat(100) } }
				}
			]
		}
		const bytes = encodeArchivePayload(payload)
		const atLimit = prepareArchiveSeal(payload, { kind: 'none' }, { payloadBytes: bytes.length })
		atLimit.release()
		expect(() =>
			prepareArchiveSeal(payload, { kind: 'none' }, { payloadBytes: bytes.length - 1 })
		).toThrow('limitExceeded')
	})
	it('handles released and already claimed requests without disturbing their owner', async () => {
		const discarded = prepareArchiveSeal(sample(), { kind: 'none' })
		discarded.release()
		expect(await run(discarded)).toEqual({ outcome: 'failed', code: 'resourceReleased' })
		const request = prepareArchiveSeal(sample(), { kind: 'password', password })
		const first = run(request),
			second = run(request)
		expect(await second).toEqual({ outcome: 'failed', code: 'operationInUse' })
		const result = await first
		expect(result.outcome).toBe('sealed')
		if (result.outcome === 'sealed') result.archive.release()
		expect(await run(request)).toEqual({ outcome: 'failed', code: 'resourceReleased' })
	})
	it.each(['CANCEL', 'SHUTDOWN'])(
		'drains an in-flight digest before %s completes',
		async (type) => {
			const original = crypto.subtle.digest.bind(crypto.subtle)
			const gate = deferred<ArrayBuffer>()
			let captured: Uint8Array | undefined
			vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, input) => {
				captured =
					input instanceof ArrayBuffer
						? new Uint8Array(input)
						: new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
				void original(algorithm, input).then(gate.resolve, gate.reject)
				return gate.promise.then(
					(value) =>
						new Promise<ArrayBuffer>((resolve) => {
							finish = () => resolve(value)
						})
				)
			})
			let finish: (() => void) | undefined
			const request = prepareArchiveSeal(sample(), { kind: 'none' })
			const actor = createActor(createArchiveEnvelopeMachine(), { input: { request } })
			actor.start()
			await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
			if (type === 'CANCEL') actor.send({ type: 'CANCEL' })
			else actor.send({ type: 'SHUTDOWN' })
			expect(actor.getSnapshot().status).toBe('active')
			finish?.()
			expect(await toPromise(actor)).toEqual({
				outcome: type === 'CANCEL' ? 'cancelled' : 'closed'
			})
			expect(captured?.every((byte) => byte === 0)).toBe(true)
		}
	)
	it('keeps snapshots secret-free and reports repeated request release only once', async () => {
		const request = prepareArchiveSeal(sample(), { kind: 'password', password })
		let revocations = 0
		let released = false
		const actor = createActor(createArchiveEnvelopeMachine(), {
			input: { request },
			inspect(event) {
				if (event.type === '@xstate.transition' && event.event.type === 'RELEASE') revocations += 1
			}
		})
		const snapshots: string[] = []
		actor.subscribe((snapshot) => {
			snapshots.push(JSON.stringify(actor.getPersistedSnapshot()))
			if (!released && snapshot.matches({ working: 'derivingKey' })) {
				released = true
				const data = envelopeData(request),
					bytes = data.bytes
				request.release()
				request.release()
				expect(data.password).toBeUndefined()
				expect(data.payload).toBeUndefined()
				expect(data.bytes).toBeUndefined()
				expect(bytes?.every((byte) => byte === 0)).toBe(true)
			}
		})
		actor.start()
		const result = await toPromise(actor)
		expect(result).toEqual({ outcome: 'failed', code: 'resourceReleased' })
		expect(revocations).toBe(1)
		for (const snapshot of snapshots)
			for (const secret of [
				password,
				'private-record-sentinel',
				'private-workspace-sentinel',
				'private-file-sentinel'
			])
				expect(snapshot).not.toContain(secret)
	})
	it.each(['hashingAttachment', 'importingPassword', 'derivingKey', 'encrypting'])(
		'cancels sealing at %s and releases any undelivered result',
		async (stage) => {
			const request = prepareArchiveSeal(sample(), { kind: 'password', password })
			const actor = createActor(createArchiveEnvelopeMachine(), { input: { request } })
			let reached = false
			let undelivered: SealedArchive | IntegrityCheckedArchive | undefined
			actor.subscribe((snapshot) => {
				if (
					!reached &&
					(snapshot.value === stage ||
						(typeof snapshot.value === 'object' && snapshot.value.working === stage))
				) {
					reached = true
					if (
						snapshot.context.result?.outcome === 'sealed' ||
						snapshot.context.result?.outcome === 'integrityChecked'
					)
						undelivered = snapshot.context.result.archive
					actor.send({ type: 'CANCEL' })
				}
			})
			actor.start()
			expect(await toPromise(actor)).toEqual({ outcome: 'cancelled' })
			expect(reached).toBe(true)
			const resource = undelivered
			if (resource && 'copyBytes' in resource)
				expect(() => resource.copyBytes()).toThrow('resourceReleased')
			expect(await run(request)).toEqual({ outcome: 'failed', code: 'resourceReleased' })
		}
	)
	it.each([
		'importingPassword',
		'derivingKey',
		'decrypting',
		'hashingPayload',
		'hashingAttachment'
	])('closes opening at %s and releases any undelivered result', async (stage) => {
		const request = prepareArchiveOpen(wire(externalEncrypted()), password)
		const actor = createActor(createArchiveEnvelopeMachine(), { input: { request } })
		let reached = false
		let undelivered: IntegrityCheckedArchive | undefined
		actor.subscribe((snapshot) => {
			if (
				!reached &&
				(snapshot.value === stage ||
					(typeof snapshot.value === 'object' && snapshot.value.working === stage))
			) {
				reached = true
				if (snapshot.context.result?.outcome === 'integrityChecked')
					undelivered = snapshot.context.result.archive
				actor.send({ type: 'SHUTDOWN' })
			}
		})
		actor.start()
		expect(await toPromise(actor)).toEqual({ outcome: 'closed' })
		expect(reached).toBe(true)
		const resource = undelivered
		if (resource) expect(() => resource.readPayload()).toThrow('resourceReleased')
	})
	it('releases a plain opening during decoding without hashing or retaining parsed input', async () => {
		const request = prepareArchiveOpen(
			wire(externalPlain(Buffer.from(encodeArchivePayload(sample()))))
		)
		const actor = createActor(createArchiveEnvelopeMachine(), { input: { request } })
		const digest = vi.spyOn(crypto.subtle, 'digest')
		let reached = false
		const decode = binary.decodeBase64
		vi.spyOn(binary, 'decodeBase64').mockImplementation((...args) => {
			const bytes = decode(...args)
			reached = true
			request.release()
			return bytes
		})
		actor.start()
		expect(await toPromise(actor)).toEqual({ outcome: 'failed', code: 'resourceReleased' })
		expect(reached).toBe(true)
		expect(digest).not.toHaveBeenCalled()
		expect(await run(request)).toEqual({ outcome: 'failed', code: 'resourceReleased' })
	})
	it('fails password-header generation through cleanup before invoking crypto', async () => {
		vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
			throw new Error('private entropy failure')
		})
		const imported = vi.spyOn(crypto.subtle, 'importKey')
		const digest = vi.spyOn(crypto.subtle, 'digest')
		const request = prepareArchiveSeal(sample(), { kind: 'password', password })
		expect(await run(request)).toEqual({ outcome: 'failed', code: 'cryptoFailed' })
		expect(imported).not.toHaveBeenCalled()
		expect(digest).not.toHaveBeenCalled()
		expect(await run(request)).toEqual({ outcome: 'failed', code: 'resourceReleased' })
	})
	it('uses nonextractable keys and clears password bytes after asynchronous import rejection', async () => {
		const imported = vi
			.spyOn(crypto.subtle, 'importKey')
			.mockRejectedValue(new Error('private-native-error'))
		expect(await run(prepareArchiveSeal(sample(), { kind: 'password', password }))).toEqual({
			outcome: 'failed',
			code: 'cryptoFailed'
		})
		const bytes = imported.mock.calls[0]?.[1]
		expect(bytes).toBeInstanceOf(Uint8Array)
		if (bytes instanceof Uint8Array) expect(bytes.every((byte) => byte === 0)).toBe(true)
		imported.mockRestore()
		const derived = vi.spyOn(crypto.subtle, 'deriveKey')
		await seal({ kind: 'password', password })
		const key = await derived.mock.results[0]?.value
		expect(key?.extractable).toBe(false)
		expect(key?.usages).toEqual(['encrypt'])
	})
	it('rejects fabricated requests and transfers completed output independently of its request', async () => {
		const fake: ArchiveEnvelopeRequest = {
			release() {},
			toJSON: () => ({ kind: 'archiveEnvelopeRequest' })
		}
		expect(await run(fake)).toEqual({ outcome: 'failed', code: 'resourceReleased' })
		const request = prepareArchiveSeal(sample(), { kind: 'none' })
		const result = await run(request)
		if (result.outcome !== 'sealed') throw new Error(JSON.stringify(result))
		request.release()
		const copy = result.archive.copyBytes()
		copy.fill(0)
		expect(result.archive.copyBytes()).not.toEqual(copy)
		result.archive.release()
		expect(() => result.archive.copyBytes()).toThrow('resourceReleased')
	})
	it('cleans an explicitly released request even after its actor has stopped', async () => {
		const original = crypto.subtle.digest.bind(crypto.subtle)
		const gate = deferred<ArrayBuffer>()
		let captured: Uint8Array | undefined
		vi.spyOn(crypto.subtle, 'digest').mockImplementation((_algorithm, input) => {
			captured =
				input instanceof ArrayBuffer
					? new Uint8Array(input)
					: new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
			return gate.promise
		})
		const request = prepareArchiveSeal(sample(), { kind: 'none' })
		const actor = createActor(createArchiveEnvelopeMachine(), { input: { request } })
		let notifications = 0
		actor.subscribe(() => {
			notifications += 1
		})
		actor.start()
		await vi.waitFor(() => expect(captured).toBeDefined())
		const data = captured
		if (!data) throw new Error('Digest did not start')
		const digest = await original('SHA-256', Uint8Array.from(data))
		request.release()
		actor.stop()
		const count = notifications
		gate.resolve(digest)
		await vi.waitFor(() => expect(data.every((byte) => byte === 0)).toBe(true))
		expect(notifications).toBe(count)
		expect(await run(request)).toEqual({ outcome: 'failed', code: 'resourceReleased' })
	})
	it('clears decoded attachment bytes on synchronous native errors and reports only safe failure codes', async () => {
		let captured: Uint8Array | undefined
		vi.spyOn(crypto.subtle, 'digest').mockImplementation((_algorithm, input) => {
			captured =
				input instanceof ArrayBuffer
					? new Uint8Array(input)
					: new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
			throw new Error('private-error-sentinel')
		})
		const result = await run(prepareArchiveSeal(sample(), { kind: 'none' }))
		expect(result).toEqual({ outcome: 'failed', code: 'cryptoFailed' })
		expect(captured?.every((byte) => byte === 0)).toBe(true)
	})
})
