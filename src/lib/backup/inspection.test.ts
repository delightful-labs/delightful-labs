import {
	buildCheckedArchive,
	type EnvelopeSuccess,
	type IntegrityCheckedArchive
} from './envelope-operation.js'
import {
	createArchiveEnvelopeMachine,
	type ArchiveEnvelopeInput
} from '../machines/backup/envelope.js'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, toPromise } from 'xstate'
import vector from '../../../tests/fixtures/archive-envelope-v1.json'
import {
	prepareArchiveInspection,
	type ArchiveInspectionRequest,
	type ArchiveInspectionReport,
	type ArchiveProfileValidator
} from './inspection-api.js'
import { createArchiveInspectionMachine } from '../machines/backup/inspection.js'
import { parseArchivePayload, type ArchivePayload } from './archive.js'

const utf8 = new TextEncoder()
function plain() {
	const base = parseArchivePayload(Buffer.from(vector.payloadBase64, 'base64'))
	const payload = {
		...base,
		source: { ...base.source, workspaceId: 'private-workspace' },
		records: [
			{ type: 'note', id: 'one', fields: { text: { kind: 'text', value: 'private-record' } } }
		]
	}
	const bytes = Buffer.from(JSON.stringify(payload))
	return utf8.encode(
		JSON.stringify({
			magic: 'DLF-BACKUP',
			version: 1,
			protection: 'none',
			payload: bytes.toString('base64'),
			sha256: createHash('sha256').update(bytes).digest('hex')
		})
	)
}
function encrypted() {
	return utf8.encode(JSON.stringify(vector.envelope))
}
function source(bytes = plain()) {
	return { read: vi.fn(() => Promise.resolve(bytes.slice())) }
}
function run(request: ArchiveInspectionRequest) {
	const actor = createActor(createArchiveInspectionMachine(), { input: { request } })
	actor.start()
	return toPromise(actor)
}
function profile(
	validate: ArchiveProfileValidator['validate'] = () => true
): ArchiveProfileValidator {
	return { id: 'vector.notes', version: 1, validate }
}
function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error('Not initialized')
	}
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

describe('inspection scope and profile validation', () => {
	it('reports generic integrity separately, with private releasable metadata and no record values', async () => {
		const owned = plain(),
			read = vi.fn(() => Promise.resolve(owned))
		const request = prepareArchiveInspection({ source: { read } })
		const actor = createActor(createArchiveInspectionMachine(), { input: { request } })
		const snapshots: string[] = []
		actor.subscribe(() => snapshots.push(JSON.stringify(actor.getPersistedSnapshot())))
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('integrityValidProfileUnsupported')
		if (!('report' in result)) throw new Error(JSON.stringify(result))
		const summary = result.report.readSummary()
		expect(summary).toMatchObject({
			profile: { id: 'vector.notes', version: 1 },
			declaredSource: { workspaceId: 'private-workspace' },
			protection: 'none',
			records: 1,
			attachments: 0
		})
		expect(Object.isFrozen(summary)).toBe(true)
		expect(JSON.stringify(summary)).not.toContain('private-record')
		expect(
			snapshots.every(
				(snapshot) =>
					!snapshot.includes('private-workspace') &&
					!snapshot.includes('private-record') &&
					!snapshot.includes(vector.payloadBase64)
			)
		).toBe(true)
		expect(owned.every((byte) => byte === 0)).toBe(true)
		request.release()
		expect(result.report.readSummary()).toEqual(summary)
		result.report.release()
		result.report.release()
		expect(() => result.report.readSummary()).toThrow()
	})
	it('accepts transferred Node Buffers without erasing the envelope child’s detached copy', async () => {
		const owned = Buffer.from(plain())
		const result = await run(
			prepareArchiveInspection({ source: { read: () => Promise.resolve(owned) } })
		)
		expect(result.outcome).toBe('integrityValidProfileUnsupported')
		expect(owned.every((byte) => byte === 0)).toBe(true)
		if ('report' in result) result.report.release()
	})
	it.each([true, false])(
		'runs an exact registered validator and reports validity %s',
		async (valid) => {
			const validate = vi.fn((payload: ArchivePayload) => {
				expect(Object.isFrozen(payload)).toBe(true)
				return valid
			})
			const result = await run(
				prepareArchiveInspection({ source: source(), profiles: [profile(validate)] })
			)
			expect(result.outcome).toBe(valid ? 'profileValid' : 'profileInvalid')
			expect(validate).toHaveBeenCalledOnce()
			if ('report' in result) result.report.release()
		}
	)
	it.each([
		{ id: 'different', version: 1 },
		{ id: 'vector.notes', version: 2 }
	])('never guesses a profile match: %j', async (binding) => {
		const validate = vi.fn(() => true)
		const result = await run(
			prepareArchiveInspection({ source: source(), profiles: [{ ...binding, validate }] })
		)
		expect(result.outcome).toBe('integrityValidProfileUnsupported')
		expect(validate).not.toHaveBeenCalled()
		if ('report' in result) result.report.release()
	})
	it('rejects duplicate/malformed registrations before reading and detaches registration metadata', async () => {
		const input = source(),
			candidate = profile()
		expect(() =>
			prepareArchiveInspection({ source: input, profiles: [candidate, candidate] })
		).toThrow('invalidInspectorConfiguration')
		expect(() =>
			prepareArchiveInspection({ source: input, profiles: [{ ...candidate, version: 0 }] })
		).toThrow('invalidInspectorConfiguration')
		expect(input.read).not.toHaveBeenCalled()
		const request = prepareArchiveInspection({ source: input, profiles: [candidate] })
		candidate.version = 2
		const result = await run(request)
		expect(result.outcome).toBe('profileValid')
		if ('report' in result) result.report.release()
	})
	it.each([
		{ id: 'é'.repeat(129), limits: {} },
		{ id: 'vector.notes', limits: { idBytes: 4 } }
	])('uses archive profile byte limits for registration: %j', ({ id, limits }) => {
		expect(() =>
			prepareArchiveInspection({ source: source(), profiles: [{ ...profile(), id }], limits })
		).toThrow('invalidInspectorConfiguration')
	})
	it('sanitizes validator exceptions and does not run validators on invalid integrity', async () => {
		const result = await run(
			prepareArchiveInspection({
				source: source(),
				profiles: [
					profile(() => {
						throw new Error('private-value')
					})
				]
			})
		)
		expect(result).toEqual({ outcome: 'failed', code: 'profileValidationFailed' })
		const validate = vi.fn(() => true),
			bytes = plain()
		bytes[bytes.length - 5] = 0
		expect(
			(
				await run(
					prepareArchiveInspection({ source: source(bytes), profiles: [profile(validate)] })
				)
			).outcome
		).toBe('failed')
		expect(validate).not.toHaveBeenCalled()
	})
})

describe('password and input boundaries', () => {
	it('reports passwordRequired before attempting opening without a password capability', async () => {
		expect(await run(prepareArchiveInspection({ source: source(encrypted()) }))).toEqual({
			outcome: 'passwordRequired'
		})
	})
	it('reads a password only for encrypted files and preserves exact input', async () => {
		const read = vi.fn(() => Promise.resolve(vector.password))
		const unencrypted = await run(
			prepareArchiveInspection({ source: source(), password: { read } })
		)
		expect(read).not.toHaveBeenCalled()
		if ('report' in unencrypted) unencrypted.report.release()
		const checked = await run(
			prepareArchiveInspection({ source: source(encrypted()), password: { read } })
		)
		expect(checked.outcome).toBe('integrityValidProfileUnsupported')
		expect(read).toHaveBeenCalledOnce()
		if ('report' in checked) checked.report.release()
		expect(
			await run(
				prepareArchiveInspection({
					source: source(encrypted()),
					password: { read: () => Promise.resolve(vector.password + '\n') }
				})
			)
		).toEqual({ outcome: 'failed', code: 'authenticationFailed' })
	})
	it('forwards the strict file byte limit and rejects oversized input', async () => {
		const input = source()
		const result = await run(prepareArchiveInspection({ source: input }))
		expect(input.read).toHaveBeenCalledWith(expect.any(AbortSignal), 64 * 1024 * 1024)
		if ('report' in result) result.report.release()
		expect(
			await run(prepareArchiveInspection({ source: source(new Uint8Array(64 * 1024 * 1024 + 1)) }))
		).toEqual({ outcome: 'failed', code: 'limitExceeded' })
	})
	it.each(['throw', 'reject'])('sanitizes %s from a file reader', async (mode) => {
		const read = () => {
			if (mode === 'throw') throw new Error('private-file-path')
			return Promise.reject(new Error('private-file-path'))
		}
		expect(await run(prepareArchiveInspection({ source: { read } }))).toEqual({
			outcome: 'failed',
			code: 'fileReadFailed'
		})
	})
	it.each(['throw', 'reject'])('sanitizes %s from a password reader', async (mode) => {
		const read = () => {
			if (mode === 'throw') throw new Error('private-password')
			return Promise.reject(new Error('private-password'))
		}
		expect(
			await run(prepareArchiveInspection({ source: source(encrypted()), password: { read } }))
		).toEqual({ outcome: 'failed', code: 'passwordReadFailed' })
	})
	it('rejects duplicate headers and reduced payload limits before requesting a password', async () => {
		const read = vi.fn(() => Promise.resolve(vector.password))
		expect(
			await run(
				prepareArchiveInspection({
					source: source(utf8.encode('{"version":1,"version":1}')),
					password: { read }
				})
			)
		).toEqual({ outcome: 'failed', code: 'duplicateKey' })
		expect(
			(
				await run(
					prepareArchiveInspection({
						source: source(encrypted()),
						password: { read },
						limits: { payloadBytes: 1 }
					})
				)
			).outcome
		).toBe('failed')
		expect(read).not.toHaveBeenCalled()
	})
})

describe('inspection lifecycle', () => {
	it.each([
		'claiming',
		'reading',
		'checkingSource',
		'preparingEnvelope',
		'opening',
		'matchingProfile',
		'inspectingProfile',
		'buildingReport',
		'cleaning'
	])('cancels at %s with owned report cleanup', async (stage) => {
		const request = prepareArchiveInspection({ source: source(), profiles: [profile()] })
		const actor = createActor(createArchiveInspectionMachine(), { input: { request } })
		let reached = false
		let report: ArchiveInspectionReport | undefined
		actor.subscribe((snapshot) => {
			if (
				(snapshot.value === stage ||
					(typeof snapshot.value === 'object' && snapshot.value.working === stage)) &&
				!reached
			) {
				reached = true
				if (snapshot.context.result && 'report' in snapshot.context.result)
					report = snapshot.context.result.report
				actor.send({ type: 'CANCEL' })
			}
		})
		actor.start()
		expect(await toPromise(actor)).toEqual({ outcome: 'cancelled' })
		expect(reached).toBe(true)
		const acquired = report
		if (acquired) expect(() => acquired.readSummary()).toThrow()
	})
	it('aborts a pending file read and drains/clears bytes from a late provider', async () => {
		const gate = deferred<Uint8Array>(),
			owned = plain()
		let signal: AbortSignal | undefined
		const request = prepareArchiveInspection({
			source: {
				read: (input) => {
					signal = input
					return gate.promise
				}
			}
		})
		const actor = createActor(createArchiveInspectionMachine(), { input: { request } })
		actor.start()
		await vi.waitFor(() => expect(signal).toBeDefined())
		actor.send({ type: 'SHUTDOWN' })
		expect(signal?.aborted).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		gate.resolve(owned)
		expect(await toPromise(actor)).toEqual({ outcome: 'closed' })
		expect(owned.every((byte) => byte === 0)).toBe(true)
	})
	it('reports repeated release once and drains the aborted source before failing', async () => {
		const gate = deferred<Uint8Array>()
		const owned = plain()
		let signal: AbortSignal | undefined
		let revocations = 0
		const request = prepareArchiveInspection({
			source: {
				read(input) {
					signal = input
					return gate.promise
				}
			}
		})
		const actor = createActor(createArchiveInspectionMachine(), {
			input: { request },
			inspect(event) {
				if (event.type === '@xstate.event' && event.event.type === 'RELEASE') revocations += 1
			}
		})
		actor.start()
		await vi.waitFor(() => expect(signal).toBeDefined())
		request.release()
		request.release()
		expect(revocations).toBe(1)
		expect(signal?.aborted).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		gate.resolve(owned)
		expect(await toPromise(actor)).toEqual({ outcome: 'failed', code: 'inspectionFailed' })
		expect(owned.every((byte) => byte === 0)).toBe(true)
	})
	it('drains an issued envelope digest after inspection request release', async () => {
		const gate = deferred<ArrayBuffer>()
		const request = prepareArchiveInspection({ source: source() })
		const native = vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(gate.promise)
		const actor = createActor(createArchiveInspectionMachine(), { input: { request } })
		try {
			actor.start()
			await vi.waitFor(() => expect(native).toHaveBeenCalledOnce())
			const borrowed = native.mock.calls[0]?.[1]
			request.release()
			expect(actor.getSnapshot().status).toBe('active')
			gate.resolve(new Uint8Array(32).buffer)
			expect(await toPromise(actor)).toEqual({ outcome: 'failed', code: 'inspectionFailed' })
			expect(borrowed).toBeInstanceOf(Uint8Array)
			if (borrowed instanceof Uint8Array) expect(borrowed.every((byte) => byte === 0)).toBe(true)
		} finally {
			gate.resolve(new Uint8Array(32).buffer)
			actor.stop()
			native.mockRestore()
		}
	})
	it('cancels a pending password source without starting cryptography', async () => {
		const gate = deferred<string>()
		let signal: AbortSignal | undefined
		const request = prepareArchiveInspection({
			source: source(encrypted()),
			password: {
				read: (input) => {
					signal = input
					return gate.promise
				}
			}
		})
		const actor = createActor(createArchiveInspectionMachine(), { input: { request } })
		actor.start()
		await vi.waitFor(() => expect(signal).toBeDefined())
		actor.send({ type: 'CANCEL' })
		expect(signal?.aborted).toBe(true)
		gate.resolve(vector.password)
		expect(await toPromise(actor)).toEqual({ outcome: 'cancelled' })
	})
	it('does not let a second claim release the first owner and rejects released/fabricated requests', async () => {
		const request = prepareArchiveInspection({ source: source() })
		const first = run(request),
			second = run(request)
		expect((await second).outcome).toBe('failed')
		const result = await first
		expect(result.outcome).toBe('integrityValidProfileUnsupported')
		if ('report' in result) result.report.release()
		expect((await run(request)).outcome).toBe('failed')
		expect(
			(await run({ release() {}, toJSON: () => ({ kind: 'archiveInspectionRequest' }) })).outcome
		).toBe('failed')
	})
	it.each(['buildingChecked', 'cleaning'])(
		'retains and releases child output on abrupt stop during child %s',
		async (stage) => {
			let acquired: IntegrityCheckedArchive | undefined
			const open = createArchiveEnvelopeMachine().provide({
				actors: {
					buildChecked: fromPromise<EnvelopeSuccess, ArchiveEnvelopeInput>(({ input }) => {
						const output = buildCheckedArchive(input.request)
						if (output.outcome === 'integrityChecked') acquired = output.archive
						return Promise.resolve(output)
					})
				}
			})
			const request = prepareArchiveInspection({ source: source() })
			const actor = createActor(createArchiveInspectionMachine().provide({ actors: { open } }), {
				input: { request }
			})
			let attached = false,
				stopped = false
			let subscription: { unsubscribe(): void } | undefined
			actor.subscribe((snapshot) => {
				if (!attached && snapshot.matches({ working: 'opening' }) && snapshot.children.envelope) {
					attached = true
					subscription = snapshot.children.envelope.subscribe((child) => {
						if (
							!stopped &&
							'value' in child &&
							(child.value === stage ||
								(typeof child.value === 'object' &&
									child.value !== null &&
									'working' in child.value &&
									child.value.working === stage))
						) {
							stopped = true
							request.release()
							actor.stop()
						}
					})
				}
			})
			actor.start()
			await vi.waitFor(() => expect(stopped).toBe(true))
			const resource = acquired
			expect(resource).toBeDefined()
			if (resource) expect(() => resource.readPayload()).toThrow('resourceReleased')
			subscription?.unsubscribe()
		}
	)
	it.each(['release-and-stop', 'stop'])(
		'clears a late source after abrupt %s',
		async (teardown) => {
			const gate = deferred<Uint8Array>(),
				owned = plain()
			const read = vi.fn(() => gate.promise)
			const request = prepareArchiveInspection({ source: { read } })
			const actor = createActor(createArchiveInspectionMachine(), { input: { request } })
			actor.start()
			await vi.waitFor(() => expect(read).toHaveBeenCalled())
			if (teardown === 'release-and-stop') request.release()
			actor.stop()
			gate.resolve(owned)
			await vi.waitFor(() => expect(owned.every((byte) => byte === 0)).toBe(true))
		}
	)
})
