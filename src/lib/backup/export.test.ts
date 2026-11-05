import { afterEach, describe, expect, it, vi } from 'vitest'
import { assign, createActor, fromPromise, setup, toPromise, waitFor } from 'xstate'
import {
	createArchiveExportMachine,
	createArchiveExportCleanupMachine
} from '../machines/backup/export.js'
import { createArchiveCaptureMachine } from '../machines/backup/capture.js'
import { createArchiveEnvelopeMachine } from '../machines/backup/envelope.js'
import { createArchiveInspectionMachine } from '../machines/backup/inspection.js'
import { prepareArchiveInspection } from './inspection-api.js'
import { prepareArchiveOpen } from './envelope-api.js'
import * as envelopeOperations from './envelope-operation.js'
import type { SealedArchive } from './envelope-operation.js'
import { encodeArchivePayload, parseArchivePayload, type ArchivePayload } from './archive.js'
import {
	prepareArchiveExport,
	sameBackupBinding,
	type ArchiveCaptureLease,
	type ArchiveExportRequest,
	type ArchiveHandoffFile,
	type ArchiveHandoffObservation,
	type BackupBinding
} from './export-api.js'
import {
	createAdmittedArchiveSource,
	type ArchiveCaptureReaderInput,
	type ArchiveCaptureReaderResult
} from './export-api.js'
import {
	createMutationAdmission,
	type MutationAdmissionResult
} from '../machines/data/admission.js'

const binding: BackupBinding = Object.freeze({
	applicationId: 'test-app',
	environment: 'disposable',
	identityId: 'owner',
	workspaceId: 'source-book',
	generation: 7,
	operationId: 'export-one'
})
const testProfile = {
	id: 'test.graph',
	version: 1,
	validate: (payload: ArchivePayload) => payload.records.length === 2
}
function admitted<Lease>(result: MutationAdmissionResult<Lease>): Lease {
	if (result.outcome !== 'admitted') throw new Error(result.reason)
	return result.lease
}

function domainReader(read: () => Promise<unknown>, crashOnCancel = false) {
	type ReaderContext = ArchiveCaptureReaderInput & {
		failure: ArchiveCaptureReaderResult | undefined
	}
	const actors = {
		metadata: fromPromise<void, ArchiveCaptureReaderInput>(({ input }) =>
			input.issue(() => Promise.resolve()).then(() => undefined)
		),
		graph: fromPromise<void, ArchiveCaptureReaderInput>(({ input }) =>
			input.issue(read).then((graph) => input.accept(graph))
		)
	}
	return setup<
		ReaderContext,
		{ type: 'CANCEL' | 'SHUTDOWN' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		ArchiveCaptureReaderInput,
		ArchiveCaptureReaderResult
	>({ actors }).createMachine({
		context: ({ input }) => ({ ...input, failure: undefined }),
		output: ({ context }) => context.failure ?? { outcome: 'read' },
		initial: 'metadata',
		on: {
			CANCEL: {
				actions: () => {
					if (crashOnCancel) throw new Error('private-reader-crash')
				}
			}
		},
		states: {
			metadata: {
				invoke: {
					src: 'metadata',
					input: ({ context }) => context,
					onDone: 'graph',
					onError: 'failed'
				}
			},
			graph: {
				invoke: {
					src: 'graph',
					input: ({ context }) => context,
					onDone: 'complete',
					onError: 'failed'
				}
			},
			complete: { type: 'final' },
			failed: {
				type: 'final',
				entry: assign({ failure: { outcome: 'failed', code: 'exportFailed' } })
			}
		}
	})
}
async function retryCleanup(request: ArchiveExportRequest) {
	const actor = createActor(createArchiveExportCleanupMachine(), { input: { request } })
	actor.start()
	const result = await toPromise(actor)
	if (result.outcome === 'failed') throw new Error(result.code)
}

function sample(): ArchivePayload {
	return {
		archiveId: '12345678-1234-4234-8234-123456789abc',
		profile: { id: testProfile.id, version: testProfile.version },
		source: { applicationId: binding.applicationId, workspaceId: binding.workspaceId },
		capturedAt: '2026-11-03T00:00:00.000Z',
		coverage: {
			mode: 'complete-supported-graph',
			recordTypes: ['root', 'note'],
			history: 'current-data',
			deletedRecords: 'excluded',
			consistency: 'quiescent-single-user'
		},
		records: [
			{ type: 'root', id: 'one', fields: { title: { kind: 'text', value: 'private-title' } } },
			{
				type: 'note',
				id: 'note',
				fields: {
					root: { kind: 'reference', type: 'root', id: 'one' },
					body: { kind: 'text', value: 'First line\nPreserve archived content' },
					archived: { kind: 'boolean', value: true },
					file: { kind: 'attachment', id: 'binary' }
				}
			}
		],
		attachments: [
			{
				id: 'binary',
				mediaType: 'application/octet-stream',
				fileName: 'bytes.bin',
				sizeBytes: 4,
				data: 'AP+ACg==',
				sha256: '6d6f7836f1e146dc0204afb5133dae52fdc05603d8ac2dc793b481b0e0829fd1'
			}
		],
		references: []
	}
}
function deferred<T>() {
	let resolve: (value: T) => void = () => {
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
function harness() {
	const payload = sample()
	const drain = vi.fn((_signal: AbortSignal) => Promise.resolve())
	const read = vi.fn((_signal: AbortSignal) => Promise.resolve<unknown>(payload))
	const checkConsistency = vi.fn((_signal: AbortSignal) => Promise.resolve(true))
	const release = vi.fn(() => Promise.resolve())
	const lease: ArchiveCaptureLease = { drain, read, checkConsistency, release }
	const checkAuthority = vi.fn((_binding: BackupBinding, _signal: AbortSignal) =>
		Promise.resolve(true)
	)
	const acquire = vi.fn((_binding: BackupBinding, _signal: AbortSignal) => Promise.resolve(lease))
	const dispatch = vi.fn(
		(_file: ArchiveHandoffFile, _binding: BackupBinding, _signal: AbortSignal) =>
			Promise.resolve<ArchiveHandoffObservation>('dispatched')
	)
	const request = (overrides: Partial<Parameters<typeof prepareArchiveExport>[0]> = {}) =>
		prepareArchiveExport({
			binding,
			source: { checkAuthority, acquire },
			handoff: { dispatch },
			profile: testProfile,
			protection: { kind: 'none' },
			...overrides
		})
	return {
		payload,
		drain,
		read,
		checkConsistency,
		release,
		lease,
		checkAuthority,
		acquire,
		dispatch,
		request
	}
}
function start(request: ArchiveExportRequest) {
	const actor = createActor(createArchiveExportMachine(), { input: { request } })
	actor.start()
	return actor
}
async function opened(bytes: Uint8Array, password?: string) {
	const actor = createActor(createArchiveEnvelopeMachine(), {
		input: { request: prepareArchiveOpen(bytes, password) }
	})
	actor.start()
	const result = await toPromise(actor)
	if (result.outcome !== 'integrityChecked') throw new Error(JSON.stringify(result))
	return result.archive
}
function canonical(payload: ArchivePayload) {
	return parseArchivePayload(encodeArchivePayload(payload))
}
afterEach(() => vi.restoreAllMocks())

describe('export content and consumer boundaries', () => {
	it.each(['none', 'password'])(
		'produces independently checked exact graph contents with %s protection',
		async (kind) => {
			const h = harness()
			let retained = new Uint8Array()
			h.dispatch.mockImplementation((file) => {
				expect(h.release).toHaveBeenCalledOnce()
				expect('release' in file).toBe(false)
				retained = file.copyBytes()
				return Promise.resolve('dispatched')
			})
			const password = ' exact-secret-é😀 '
			const request = h.request({
				protection: kind === 'none' ? { kind: 'none' } : { kind: 'password', password }
			})
			const actor = createActor(createArchiveExportMachine(), { input: { request } })
			const snapshots: string[] = []
			actor.subscribe(() => snapshots.push(JSON.stringify(actor.getPersistedSnapshot())))
			actor.start()
			expect(await toPromise(actor)).toEqual({
				outcome: 'exported',
				binding,
				archiveProduced: true,
				handoff: 'dispatched'
			})
			const checked = await opened(retained, kind === 'password' ? password : undefined)
			expect(checked.readPayload()).toEqual(canonical(h.payload))
			expect(testProfile.validate(checked.readPayload())).toBe(true)
			const attachment = checked.readPayload().attachments[0]
			expect(Buffer.from(attachment?.data ?? '', 'base64')).toEqual(Buffer.from([0, 255, 128, 10]))
			checked.release()
			const inspector = createActor(createArchiveInspectionMachine(), {
				input: {
					request: prepareArchiveInspection({
						source: { read: () => Promise.resolve(retained.slice()) },
						profiles: [testProfile],
						...(kind === 'password' ? { password: { read: () => Promise.resolve(password) } } : {})
					})
				}
			})
			inspector.start()
			const inspection = await toPromise(inspector)
			expect(inspection.outcome).toBe('profileValid')
			if ('report' in inspection) inspection.report.release()
			for (const snapshot of snapshots) {
				for (const secret of [
					password,
					'First line',
					'Preserve archived content',
					'bytes.bin',
					'AP+ACg=='
				])
					expect(snapshot).not.toContain(secret)
			}
			expect(() => h.dispatch.mock.calls[0]?.[0].copyBytes()).toThrow('resourceReleased')
			expect(h.read).toHaveBeenCalledOnce()
			expect(h.release).toHaveBeenCalledOnce()
			retained.fill(0)
		}
	)
	it('freezes detached capture before the source consistency observation', async () => {
		const h = harness()
		const original = canonical(h.payload)
		h.checkConsistency.mockImplementation(() => {
			Object.assign(h.payload.records[0]?.fields ?? {}, {
				title: { kind: 'text', value: 'late mutation' }
			})
			return Promise.resolve(true)
		})
		let bytes = new Uint8Array()
		h.dispatch.mockImplementation((file) => {
			bytes = file.copyBytes()
			return Promise.resolve('dispatched')
		})
		expect((await toPromise(start(h.request()))).outcome).toBe('exported')
		const checked = await opened(bytes)
		expect(checked.readPayload()).toEqual(original)
		checked.release()
	})
	it.each(['applicationId', 'workspaceId', 'profile', 'version'])(
		'rejects %s mismatch before handoff',
		async (field) => {
			const h = harness()
			const payload = {
				...h.payload,
				source: {
					...h.payload.source,
					...(field === 'applicationId' || field === 'workspaceId' ? { [field]: 'foreign' } : {})
				},
				profile: {
					...h.payload.profile,
					...(field === 'profile' ? { id: 'foreign' } : {}),
					...(field === 'version' ? { version: 2 } : {})
				}
			}
			h.read.mockResolvedValue(payload)
			expect(await toPromise(start(h.request()))).toMatchObject({
				outcome: 'failed',
				code: 'profileInvalid',
				archiveProduced: false
			})
			expect(h.dispatch).not.toHaveBeenCalled()
			expect(h.release).toHaveBeenCalledOnce()
		}
	)
	it.each([
		'denied',
		'inconsistent',
		'profileInvalid',
		'throwingValidator',
		'malformed',
		'oversized',
		'badDigest'
	])('rejects %s without dispatch', async (mode) => {
		const h = harness()
		if (mode === 'denied') h.checkAuthority.mockResolvedValue(false)
		if (mode === 'inconsistent') h.checkConsistency.mockResolvedValue(false)
		if (mode === 'malformed') h.read.mockResolvedValue({ password: 'private-invalid-input' })
		if (mode === 'badDigest')
			h.read.mockResolvedValue({
				...h.payload,
				attachments: h.payload.attachments.map((file) => ({ ...file, sha256: '0'.repeat(64) }))
			})
		const request = h.request({
			...(mode === 'oversized' ? { limits: { payloadBytes: 1 } } : {}),
			...(mode === 'profileInvalid' ? { profile: { ...testProfile, validate: () => false } } : {}),
			...(mode === 'throwingValidator'
				? {
						profile: {
							...testProfile,
							validate: () => {
								throw new Error('private-validator-input')
							}
						}
					}
				: {})
		})
		const result = await toPromise(start(request))
		expect(result.outcome).toBe('failed')
		expect(result.archiveProduced).toBe(false)
		expect(JSON.stringify(result)).not.toContain('private-')
		expect(h.dispatch).not.toHaveBeenCalled()
		expect(h.release).toHaveBeenCalledTimes(mode === 'denied' ? 0 : 1)
		if (mode === 'denied') expect(h.acquire).not.toHaveBeenCalled()
		if (mode === 'badDigest') expect(result).toMatchObject({ code: 'integrityMismatch' })
	})
	it.each(['throw', 'reject'])(
		'sanitizes every source leaf %s and releases only acquired resources',
		async (mode) => {
			for (const stage of ['authority', 'acquire', 'drain', 'read', 'consistency']) {
				const h = harness()
				const fail = () => {
					if (mode === 'throw') throw new Error('private-source-details')
					return Promise.reject(new Error('private-source-details'))
				}
				if (stage === 'authority') h.checkAuthority.mockImplementation(fail)
				if (stage === 'acquire') h.acquire.mockImplementation(fail)
				if (stage === 'drain') h.drain.mockImplementation(fail)
				if (stage === 'read') h.read.mockImplementation(fail)
				if (stage === 'consistency') h.checkConsistency.mockImplementation(fail)
				expect(await toPromise(start(h.request()))).toMatchObject({
					outcome: 'failed',
					code: 'exportFailed',
					handoff: 'notStarted'
				})
				expect(h.release).toHaveBeenCalledTimes(
					stage === 'authority' || stage === 'acquire' ? 0 : 1
				)
				expect(h.dispatch).not.toHaveBeenCalled()
			}
		}
	)
})

describe('handoff and binding ownership', () => {
	it('retries only handoff with identical encrypted bytes and retains earlier uncertainty', async () => {
		const h = harness()
		const copies: Uint8Array[] = []
		h.dispatch.mockImplementation((file) => {
			copies.push(file.copyBytes())
			return copies.length === 1
				? Promise.reject(new Error('private-dispatch-error'))
				: Promise.resolve('rejected')
		})
		const actor = start(h.request({ protection: { kind: 'password', password: 'retry-secret' } }))
		await waitFor(actor, (snapshot) => snapshot.hasTag('handoffRetry'), { timeout: 2000 })
		expect(actor.getSnapshot().context.handoff).toBe('unknown')
		actor.send({
			type: 'RETRY_HANDOFF',
			binding: { ...binding, generation: binding.generation - 1 }
		})
		actor.send({ type: 'INVALIDATE', binding: { ...binding, operationId: 'old-operation' } })
		expect(h.dispatch).toHaveBeenCalledOnce()
		actor.send({ type: 'RETRY_HANDOFF', binding })
		await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(2))
		await waitFor(actor, (snapshot) => snapshot.hasTag('handoffRetry'), { timeout: 1000 })
		expect(copies[0]).toEqual(copies[1])
		expect(h.read).toHaveBeenCalledOnce()
		expect(h.acquire).toHaveBeenCalledOnce()
		expect(actor.getSnapshot().context.handoff).toBe('unknown')
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toMatchObject({
			outcome: 'cancelled',
			archiveProduced: true,
			handoff: 'unknown'
		})
	})
	it('can complete a rejected dispatch by retry without recapture', async () => {
		const h = harness()
		h.dispatch.mockResolvedValueOnce('rejected')
		const actor = start(h.request())
		await waitFor(actor, (snapshot) => snapshot.hasTag('handoffRetry'), { timeout: 1000 })
		actor.send({ type: 'RETRY_HANDOFF', binding })
		expect(await toPromise(actor)).toMatchObject({ outcome: 'exported', handoff: 'dispatched' })
		expect(h.read).toHaveBeenCalledOnce()
	})
	it.each(['CANCEL', 'SHUTDOWN', 'INVALIDATE'])(
		'drains an issued handoff on %s while preserving actual dispatch',
		async (type) => {
			const h = harness(),
				gate = deferred<ArchiveHandoffObservation>()
			let file: ArchiveHandoffFile | undefined
			h.dispatch.mockImplementation((input) => {
				file = input
				return gate.promise
			})
			const actor = start(h.request())
			await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledOnce())
			if (type === 'INVALIDATE') actor.send({ type, binding })
			else actor.send({ type: type === 'SHUTDOWN' ? 'SHUTDOWN' : 'CANCEL' })
			expect(actor.getSnapshot().status).toBe('active')
			expect(h.dispatch.mock.calls[0]?.[2].aborted).toBe(true)
			expect(file?.copyBytes().length).toBeGreaterThan(0)
			gate.resolve('dispatched')
			expect(await toPromise(actor)).toMatchObject({
				outcome: type === 'CANCEL' ? 'cancelled' : type === 'SHUTDOWN' ? 'closed' : 'invalidated',
				archiveProduced: true,
				handoff: 'dispatched'
			})
			expect(() => file?.copyBytes()).toThrow('resourceReleased')
		}
	)
	it('rejects every changed binding field, including the A → B → A generation', () => {
		for (const key of ['applicationId', 'environment', 'identityId', 'workspaceId', 'operationId'])
			expect(sameBackupBinding(binding, { ...binding, [key]: 'other' })).toBe(false)
		expect(sameBackupBinding(binding, { ...binding, generation: binding.generation + 2 })).toBe(
			false
		)
		expect(sameBackupBinding(binding, { ...binding })).toBe(true)
	})
	it('latches invalidation through A → B → A, discarding late A capture without a new acquire', async () => {
		const h = harness(),
			gate = deferred<unknown>()
		h.read.mockReturnValue(gate.promise)
		const actor = start(h.request())
		await vi.waitFor(() => expect(h.read).toHaveBeenCalled())
		actor.send({ type: 'INVALIDATE', binding })
		actor.send({
			type: 'RETRY_HANDOFF',
			binding: { ...binding, generation: binding.generation + 2 }
		})
		gate.resolve(h.payload)
		expect(await toPromise(actor)).toMatchObject({ outcome: 'invalidated', handoff: 'notStarted' })
		expect(h.dispatch).not.toHaveBeenCalled()
		expect(h.acquire).toHaveBeenCalledOnce()
	})
})

describe('capture drain and resource lifetime', () => {
	it('does not claim or acquire native resources before an export actor starts', async () => {
		const h = harness(),
			request = h.request()
		const dormant = createActor(createArchiveExportMachine(), { input: { request } })
		expect(h.checkAuthority).not.toHaveBeenCalled()
		expect(h.acquire).not.toHaveBeenCalled()
		const result = await toPromise(
			createActor(createArchiveExportMachine(), { input: { request } }).start()
		)
		expect(result.outcome).toBe('exported')
		dormant.stop()
	})
	it.each([
		'checkingAuthority',
		'acquiring',
		'draining',
		'reading',
		'validating',
		'checkingConsistency',
		'releasing'
	])('cancels at capture %s without advancing into handoff', async (stage) => {
		const h = harness(),
			request = h.request()
		const actor = createActor(createArchiveExportMachine(), { input: { request } })
		let attached = false,
			reached = false
		let unsubscribe: (() => void) | undefined
		actor.subscribe((snapshot) => {
			const child = snapshot.children.effect
			if (!snapshot.matches({ working: 'capturing' }) || !child || attached) return
			attached = true
			const probe = (value: unknown) => {
				if (
					!reached &&
					typeof value === 'object' &&
					value !== null &&
					'value' in value &&
					value.value === stage
				) {
					reached = true
					actor.send({ type: 'CANCEL' })
				}
			}
			const subscription = child.subscribe(probe)
			unsubscribe = () => subscription.unsubscribe()
			probe(child.getSnapshot())
		})
		actor.start()
		expect((await toPromise(actor)).outcome).toBe('cancelled')
		expect(reached).toBe(true)
		expect(h.dispatch).not.toHaveBeenCalled()
		expect(h.release).toHaveBeenCalledTimes(h.acquire.mock.calls.length)
		unsubscribe?.()
	})
	it.each(['sealing', 'handingOff', 'handoffRetry', 'cleaning', 'releasing'])(
		'cancels at export %s and clears completed resources',
		async (stage) => {
			const h = harness(),
				request = h.request()
			if (stage === 'handoffRetry') h.dispatch.mockResolvedValue('rejected')
			const actor = createActor(createArchiveExportMachine(), { input: { request } })
			let reached = false
			actor.subscribe((snapshot) => {
				if (
					!reached &&
					(snapshot.value === stage ||
						(typeof snapshot.value === 'object' && snapshot.value.working === stage))
				) {
					reached = true
					actor.send({ type: 'CANCEL' })
				}
			})
			actor.start()
			expect((await toPromise(actor)).outcome).toBe('cancelled')
			expect(reached).toBe(true)
			if (h.dispatch.mock.calls[0])
				expect(() => h.dispatch.mock.calls[0]?.[0].copyBytes()).toThrow('resourceReleased')
		}
	)
	it.each(['CANCEL', 'SHUTDOWN', 'INVALIDATE'])(
		'collects a lease acquired after %s and awaits release',
		async (type) => {
			const h = harness(),
				acquired = deferred<ArchiveCaptureLease>(),
				released = deferred<void>()
			h.acquire.mockReturnValue(acquired.promise)
			h.release.mockReturnValue(released.promise)
			const actor = start(h.request())
			await vi.waitFor(() => expect(h.acquire).toHaveBeenCalled())
			if (type === 'INVALIDATE') actor.send({ type, binding })
			else actor.send({ type: type === 'SHUTDOWN' ? 'SHUTDOWN' : 'CANCEL' })
			expect(h.acquire.mock.calls[0]?.[1].aborted).toBe(true)
			expect(actor.getSnapshot().status).toBe('active')
			acquired.resolve(h.lease)
			await vi.waitFor(() => expect(h.release).toHaveBeenCalledOnce())
			expect(actor.getSnapshot().status).toBe('active')
			expect(h.drain).not.toHaveBeenCalled()
			released.resolve()
			expect((await toPromise(actor)).outcome).toBe(
				type === 'CANCEL' ? 'cancelled' : type === 'SHUTDOWN' ? 'closed' : 'invalidated'
			)
			expect(h.dispatch).not.toHaveBeenCalled()
		}
	)
	it('does not let a concurrent or reused claim steal the first export', async () => {
		const h = harness(),
			gate = deferred<unknown>(),
			request = h.request()
		h.read.mockReturnValue(gate.promise)
		const first = start(request)
		await vi.waitFor(() => expect(h.read).toHaveBeenCalled())
		expect(await toPromise(start(request))).toMatchObject({
			outcome: 'failed',
			code: 'exportInUse'
		})
		expect(h.read.mock.calls[0]?.[0].aborted).toBe(false)
		expect(h.release).not.toHaveBeenCalled()
		gate.resolve(h.payload)
		expect((await toPromise(first)).outcome).toBe('exported')
		expect(await toPromise(start(request))).toMatchObject({
			outcome: 'failed',
			code: 'exportReleased'
		})
		expect(h.release).toHaveBeenCalledOnce()
	})
	it.each(['throw', 'reject'])(
		'retains cleanup failure from %s over cancellation and retries only release',
		async (mode) => {
			const h = harness(),
				gate = deferred<unknown>()
			h.read.mockReturnValue(gate.promise)
			h.release.mockImplementationOnce(() => {
				if (mode === 'throw') throw new Error('private-lease')
				return Promise.reject(new Error('private-lease'))
			})
			const request = h.request(),
				actor = start(request)
			await expect(retryCleanup(request)).rejects.toThrow('exportInUse')
			await vi.waitFor(() => expect(h.read).toHaveBeenCalled())
			actor.send({ type: 'CANCEL' })
			gate.resolve(h.payload)
			expect(await toPromise(actor)).toMatchObject({
				outcome: 'failed',
				code: 'captureCleanupFailed'
			})
			expect(h.release).toHaveBeenCalledOnce()
			await retryCleanup(request)
			expect(h.release).toHaveBeenCalledTimes(2)
			await retryCleanup(request)
			expect(h.release).toHaveBeenCalledTimes(2)
			expect(h.dispatch).not.toHaveBeenCalled()
		}
	)

	it('rejects concurrent cleanup attempts and releases only the retained lease', async () => {
		const h = harness()
		const gate = deferred<void>()
		h.release
			.mockRejectedValueOnce(new Error('private-initial-release'))
			.mockReturnValueOnce(gate.promise)
		const request = h.request()
		expect(await toPromise(start(request))).toMatchObject({
			outcome: 'failed',
			code: 'captureCleanupFailed'
		})
		const cleanup = createActor(createArchiveExportCleanupMachine(), { input: { request } })
		cleanup.start()
		await vi.waitFor(() => expect(h.release).toHaveBeenCalledTimes(2))
		await expect(retryCleanup(request)).rejects.toThrow('exportInUse')
		expect(cleanup.getSnapshot().status).toBe('active')
		gate.resolve()
		expect(await toPromise(cleanup)).toEqual({ outcome: 'cleaned' })
		await retryCleanup(request)
		expect(h.release).toHaveBeenCalledTimes(2)
		expect(h.acquire).toHaveBeenCalledOnce()
		expect(h.read).toHaveBeenCalledOnce()
		expect(h.dispatch).not.toHaveBeenCalled()
	})
	it.each(['throw', 'reject'])(
		'retains failed cleanup custody after a %s for another explicit actor',
		async (mode) => {
			const h = harness()
			h.release
				.mockRejectedValueOnce(new Error('private-initial-release'))
				.mockImplementationOnce(() => {
					if (mode === 'throw') throw new Error('private-cleanup-failure')
					return Promise.reject(new Error('private-cleanup-failure'))
				})
			const request = h.request()
			expect(await toPromise(start(request))).toMatchObject({
				outcome: 'failed',
				code: 'captureCleanupFailed'
			})
			const cleanup = createActor(createArchiveExportCleanupMachine(), { input: { request } })
			cleanup.start()
			expect(await toPromise(cleanup)).toEqual({ outcome: 'failed', code: 'captureCleanupFailed' })
			expect(h.release).toHaveBeenCalledTimes(2)
			await retryCleanup(request)
			expect(h.release).toHaveBeenCalledTimes(3)
			expect(h.acquire).toHaveBeenCalledOnce()
			expect(h.dispatch).not.toHaveBeenCalled()
		}
	)
	it('keeps cleanup custody with a stopped actor until native release settles', async () => {
		const h = harness()
		const gate = deferred<void>()
		h.release
			.mockRejectedValueOnce(new Error('private-initial-release'))
			.mockReturnValueOnce(gate.promise)
		const request = h.request()
		expect(await toPromise(start(request))).toMatchObject({
			outcome: 'failed',
			code: 'captureCleanupFailed'
		})
		const cleanup = createActor(createArchiveExportCleanupMachine(), { input: { request } })
		cleanup.start()
		await vi.waitFor(() => expect(h.release).toHaveBeenCalledTimes(2))
		cleanup.stop()
		await expect(retryCleanup(request)).rejects.toThrow('exportInUse')
		gate.reject(new Error('private-late-release'))
		await vi.waitFor(async () => {
			await expect(retryCleanup(request)).resolves.toBeUndefined()
		})
		expect(h.release).toHaveBeenCalledTimes(3)
		expect(h.acquire).toHaveBeenCalledOnce()
		expect(h.dispatch).not.toHaveBeenCalled()
	})
	it('abruptly releases a late lease even when the actor has stopped', async () => {
		const h = harness(),
			gate = deferred<ArchiveCaptureLease>(),
			request = h.request()
		h.acquire.mockReturnValue(gate.promise)
		const actor = start(request)
		await vi.waitFor(() => expect(h.acquire).toHaveBeenCalled())
		request.release()
		actor.stop()
		await expect(retryCleanup(request)).rejects.toThrow('exportInUse')
		gate.resolve(h.lease)
		await vi.waitFor(() => expect(h.release).toHaveBeenCalledOnce())
		await retryCleanup(request)
		expect(h.read).not.toHaveBeenCalled()
	})
	it('abrupt stop waits for a late graph read before releasing the lease', async () => {
		const h = harness(),
			gate = deferred<unknown>(),
			request = h.request()
		h.read.mockReturnValue(gate.promise)
		const actor = start(request)
		await vi.waitFor(() => expect(h.read).toHaveBeenCalled())
		request.release()
		actor.stop()
		expect(h.read.mock.calls[0]?.[0].aborted).toBe(true)
		expect(h.release).not.toHaveBeenCalled()
		gate.resolve(h.payload)
		await vi.waitFor(() => expect(h.release).toHaveBeenCalledOnce())
		await retryCleanup(request)
		expect(h.checkConsistency).not.toHaveBeenCalled()
		expect(h.dispatch).not.toHaveBeenCalled()
	})
	it('abrupt stop keeps a borrowed handoff file alive until the issued effect settles', async () => {
		const h = harness(),
			gate = deferred<ArchiveHandoffObservation>(),
			request = h.request()
		let borrowed: ArchiveHandoffFile | undefined
		h.dispatch.mockImplementation((file) => {
			borrowed = file
			return gate.promise
		})
		const actor = start(request)
		await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalled())
		request.release()
		actor.stop()
		expect(borrowed?.copyBytes().length).toBeGreaterThan(0)
		await expect(retryCleanup(request)).rejects.toThrow('exportInUse')
		gate.resolve('dispatched')
		await vi.waitFor(() => expect(() => borrowed?.copyBytes()).toThrow('resourceReleased'))
		await retryCleanup(request)
		expect(h.release).toHaveBeenCalledOnce()
	})
	it('drains the resource owner after an unexpected capture-child crash', async () => {
		const h = harness(),
			gate = deferred<unknown>(),
			request = h.request()
		h.read.mockReturnValue(gate.promise)
		const capture = createArchiveCaptureMachine().provide({
			actions: {
				abort: () => {
					throw new Error('private-child-crash')
				}
			}
		})
		const actor = createActor(createArchiveExportMachine().provide({ actors: { capture } }), {
			input: { request }
		})
		actor.start()
		await vi.waitFor(() => expect(h.read).toHaveBeenCalled())
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		expect(h.release).not.toHaveBeenCalled()
		gate.resolve(h.payload)
		expect(await toPromise(actor)).toMatchObject({ outcome: 'cancelled', handoff: 'notStarted' })
		expect(h.release).toHaveBeenCalledOnce()
	})
	it('drains native digest work after cancellation without dispatch', async () => {
		const h = harness(),
			gate = deferred<ArrayBuffer>()
		const digest = vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(gate.promise)
		const actor = start(h.request())
		await vi.waitFor(() => expect(digest).toHaveBeenCalled())
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		gate.resolve(
			Uint8Array.from(
				Buffer.from('6d6f7836f1e146dc0204afb5133dae52fdc05603d8ac2dc793b481b0e0829fd1', 'hex')
			).buffer
		)
		expect((await toPromise(actor)).outcome).toBe('cancelled')
		expect(h.dispatch).not.toHaveBeenCalled()
	})
	it('releases sealed output when stopped during synchronous output construction', async () => {
		const h = harness(),
			request = h.request()
		let acquired: SealedArchive | undefined
		const build = envelopeOperations.buildSealedArchive
		vi.spyOn(envelopeOperations, 'buildSealedArchive').mockImplementation((childRequest, mode) => {
			const output = build(childRequest, mode)
			if (output.outcome === 'sealed') acquired = output.archive
			request.release()
			actor.stop()
			return output
		})
		const actor = createActor(createArchiveExportMachine(), { input: { request } })
		actor.start()
		await vi.waitFor(() => expect(acquired).toBeDefined())
		expect(() => acquired?.copyBytes()).toThrow('resourceReleased')
		expect(h.dispatch).not.toHaveBeenCalled()
	})
})

describe('admitted domain reader integration', () => {
	function source(h: ReturnType<typeof harness>, admission = createMutationAdmission()) {
		const value = createAdmittedArchiveSource({
			admission,
			checkAuthority: h.checkAuthority,
			checkConsistency: (_binding, signal) => h.checkConsistency(signal)
		})
		return {
			admission,
			value: { ...value, acquire: vi.fn(value.acquire) }
		}
	}
	it('releases admission for an initially-final cancelled reader', async () => {
		const h = harness(),
			s = source(h)
		const reader = setup<
			{},
			{ type: 'CANCEL' | 'SHUTDOWN' },
			{},
			{},
			{},
			{},
			never,
			string,
			ArchiveCaptureReaderInput,
			ArchiveCaptureReaderResult
		>({}).createMachine({
			initial: 'cancelled',
			output: () => ({ outcome: 'cancelled' }),
			states: { cancelled: { type: 'final' } }
		})
		const request = h.request({ source: s.value })
		const actor = createActor(createArchiveExportMachine({ reader }), { input: { request } })
		actor.start()
		expect(await toPromise(actor)).toMatchObject({ outcome: 'cancelled', archiveProduced: false })
		expect(h.dispatch).not.toHaveBeenCalled()
		admitted(s.admission.write()).release()
		s.admission.close()
	})
	it('preserves an explicit reader failure and reopens writes', async () => {
		const h = harness(),
			s = source(h)
		const reader = domainReader(() => Promise.reject(new Error('private-native-failure')))
		const request = h.request({ source: s.value })
		const actor = createActor(createArchiveExportMachine({ reader }), { input: { request } })
		actor.start()
		expect(await toPromise(actor)).toMatchObject({
			outcome: 'failed',
			code: 'exportFailed',
			archiveProduced: false
		})
		expect(h.dispatch).not.toHaveBeenCalled()
		admitted(s.admission.write()).release()
		s.admission.close()
	})
	it('invokes the domain reader after operation and receipt drain, without snapshotting the graph', async () => {
		const h = harness(),
			s = source(h),
			pending = deferred<void>()
		const writer = admitted(s.admission.write())
		writer.retain(pending.promise)
		const reader = vi.fn(() => Promise.resolve<unknown>(h.payload))
		const request = h.request({ source: s.value })
		const actor = createActor(createArchiveExportMachine({ reader: domainReader(reader) }), {
			input: { request }
		})
		actor.start()
		await vi.waitFor(() => expect(s.value.acquire).toHaveBeenCalledOnce())
		writer.release()
		expect(reader).not.toHaveBeenCalled()
		pending.resolve()
		expect(await toPromise(actor)).toMatchObject({ outcome: 'exported', handoff: 'dispatched' })
		expect(h.checkAuthority).toHaveBeenCalledTimes(3)
		expect(h.read).not.toHaveBeenCalled()
		expect(JSON.stringify(actor.getSnapshot())).not.toContain('private-title')
		admitted(s.admission.write()).release()
		s.admission.close()
	})
	it.each(['drain', 'read'])(
		'rejects authority replacement during %s and reopens writes',
		async (stage) => {
			const h = harness(),
				s = source(h),
				pending = deferred<unknown>()
			const writer = stage === 'drain' ? admitted(s.admission.write()) : undefined
			const reader = vi.fn(() => pending.promise)
			const request = h.request({ source: s.value })
			const actor = createActor(createArchiveExportMachine({ reader: domainReader(reader) }), {
				input: { request }
			})
			actor.start()
			if (stage === 'drain') {
				await vi.waitFor(() => expect(s.value.acquire).toHaveBeenCalledOnce())
				h.checkAuthority.mockResolvedValue(false)
				writer?.release()
			} else {
				await vi.waitFor(() => expect(reader).toHaveBeenCalled())
				h.checkAuthority.mockResolvedValue(false)
				pending.resolve(h.payload)
			}
			expect(await toPromise(actor)).toMatchObject({
				outcome: 'failed',
				code: 'authorityDenied',
				archiveProduced: false
			})
			if (stage === 'drain') expect(reader).not.toHaveBeenCalled()
			expect(h.dispatch).not.toHaveBeenCalled()
			admitted(s.admission.write()).release()
			s.admission.close()
		}
	)
	it.each(['cancel', 'crash', 'stop'])(
		'releases admission directly after %s while issued native reads drain',
		async (mode) => {
			const h = harness(),
				s = source(h),
				pending = deferred<unknown>()
			const reader = vi.fn(() => pending.promise)
			const request = h.request({ source: s.value })
			const actor = createActor(
				createArchiveExportMachine({ reader: domainReader(reader, mode === 'crash') }),
				{ input: { request } }
			)
			actor.start()
			await vi.waitFor(() => expect(reader).toHaveBeenCalled())
			if (mode === 'stop') {
				request.release()
				actor.stop()
			} else actor.send({ type: 'CANCEL' })
			admitted(s.admission.write()).release()
			if (mode !== 'stop') expect(actor.getSnapshot().status).toBe('active')
			pending.resolve(h.payload)
			if (mode !== 'stop')
				expect(await toPromise(actor)).toMatchObject({
					outcome: 'cancelled',
					archiveProduced: false
				})
			else
				await vi.waitFor(async () => {
					await retryCleanup(request)
				})
			expect(h.dispatch).not.toHaveBeenCalled()
			s.admission.close()
		}
	)
})

describe('authority observation custody', () => {
	it.each([2, 3])(
		'retains the lease across abrupt stop during authority observation %s',
		async (observation) => {
			const h = harness(),
				pending = deferred<boolean>()
			let calls = 0
			h.checkAuthority.mockImplementation(() => {
				calls += 1
				return calls === observation ? pending.promise : Promise.resolve(true)
			})
			const request = h.request(),
				actor = start(request)
			await vi.waitFor(() => expect(h.checkAuthority).toHaveBeenCalledTimes(observation))
			actor.stop()
			expect(h.release).not.toHaveBeenCalled()
			pending.resolve(true)
			await vi.waitFor(() => expect(h.release).toHaveBeenCalledOnce())
			await retryCleanup(request)
			expect(h.dispatch).not.toHaveBeenCalled()
		}
	)
})
