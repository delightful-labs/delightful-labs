import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest'
import * as payloadCodec from '../../backup/payload.js'
import { createActor, toPromise, waitFor } from 'xstate'
import {
	createExportReader as reader,
	testExportProfile as profile
} from '../../../../fixtures/native-capture/export-reader.js'
import { createJazzSession, type JazzClient } from 'jazz-tools/backend'
import { startLocalJazzServer, type LocalJazzServerHandle } from 'jazz-tools/testing'
import type { JazzSession } from 'jazz-tools/client'
import type { Db, Transaction } from 'jazz-tools'
import {
	app,
	permissions,
	bytes,
	readGraph,
	type Graph
} from '../../../../fixtures/native-capture/schema.js'
import {
	classifyJazzArchiveFailure,
	prepareJazzArchiveExport,
	type JazzArchiveReaderInput
} from './backup-api.js'
import { jazzExportFacts, requestJazzExportHandoff } from './backup.js'
import { createJazzArchiveExportMachine } from '../../machines/backup/export.js'
import { createArchiveEnvelopeMachine } from '../../machines/backup/envelope.js'
import { prepareArchiveOpen, type ArchiveProtection } from '../../backup/envelope-api.js'
import type { ArchiveHandoffFile, ArchiveHandoffObservation } from './backup-api.js'

let authority: LocalJazzServerHandle
const sessions: JazzSession<JazzClient>[] = []
let db: Db, writer: Db
let identityId: string
beforeAll(async () => {
	const server = await startLocalJazzServer({
		schema: app,
		permissions,
		inMemory: true,
		allowLocalFirstAuth: true
	})
	authority = server
	const selections: ('local-first' | { backendSecret: string })[] = [
		'local-first',
		{ backendSecret: server.backendSecret }
	]
	for (const initial of selections)
		sessions.push(
			await createJazzSession({
				appId: server.appId,
				serverUrl: server.url,
				app,
				permissions,
				initial,
				driver: { type: 'memory' }
			})
		)
	const first = sessions[0]?.getSnapshot(),
		second = sessions[1]?.getSnapshot()
	if (
		first?.status !== 'ready' ||
		!first.client ||
		second?.status !== 'ready' ||
		!second.client ||
		!first.account
	)
		throw new Error('Disposable client startup failed')
	db = first.client.db
	writer = second.client.db
	identityId = first.account.id
	db.onMutationError(() => {})
}, 30000)
afterAll(async () => {
	for (const session of sessions) await session.close()
	await authority?.stop()
})
afterEach(() => vi.restoreAllMocks())

function deferred<Value>() {
	let resolve: (value: Value) => void = () => {}
	const promise = new Promise<Value>((yes) => {
		resolve = yes
	})
	return { promise, resolve }
}
async function seed(): Promise<Graph> {
	const graph = {
		workspace: crypto.randomUUID(),
		entry: crypto.randomUUID(),
		file: crypto.randomUUID(),
		part: crypto.randomUUID()
	}
	const tx = writer.beginTransaction()
	try {
		tx.insert(
			app.workspaces,
			{ revision: 0, allowed: true, visible: true },
			{ id: graph.workspace }
		)
		tx.insert(
			app.entries,
			{ revision: 0, workspaceId: graph.workspace, fileId: graph.file },
			{ id: graph.entry }
		)
		tx.insert(
			app.files,
			{ revision: 0, workspaceId: graph.workspace, sizeBytes: 8 },
			{ id: graph.file }
		)
		tx.insert(
			app.parts,
			{ workspaceId: graph.workspace, fileId: graph.file, partIndex: 0, data: bytes(0) },
			{ id: graph.part }
		)
		await tx.commit().wait({ tier: 'global' })
		return graph
	} catch (error) {
		await tx.rollback()
		throw error
	}
}
function options(graph: Graph, protection: ArchiveProtection = { kind: 'none' }) {
	const files: Uint8Array[] = []
	return {
		files,
		value: {
			db,
			binding: {
				applicationId: 'native-test',
				workspaceId: graph.workspace,
				identityId,
				environment: 'disposable',
				operationId: crypto.randomUUID(),
				generation: 1
			},
			profile,
			protection,
			isCurrent: () => true,
			handoff: {
				dispatch: vi.fn(async (file: ArchiveHandoffFile): Promise<ArchiveHandoffObservation> => {
					files.push(file.copyBytes())
					return 'dispatched'
				})
			}
		}
	}
}
function start(
	graph: Graph,
	input = options(graph),
	pause?: (input: JazzArchiveReaderInput) => Promise<void>,
	crash = false
) {
	const request = prepareJazzArchiveExport(input.value)
	const actor = createActor(createJazzArchiveExportMachine(reader(graph, pause, crash)), {
		input: { request }
	})
	actor.start()
	return { actor, request, ...input }
}

function observeTransaction() {
	const begin = db.beginExclusiveTransaction.bind(db)
	let opened: Transaction<'exclusive'> | undefined
	vi.spyOn(db, 'beginExclusiveTransaction').mockImplementationOnce(() => {
		opened = begin()
		return opened
	})
	return () => {
		if (!opened) throw new Error('Capture transaction not opened')
		return opened
	}
}

describe('native Jazz archive export', () => {
	it('releases an unstarted request once and rejects later use', async () => {
		const graph = await seed(),
			input = options(graph)
		const reads = vi.spyOn(db, 'all')
		const request = prepareJazzArchiveExport(input.value)
		const first = request.release(),
			second = request.release()
		expect(second).toBe(first)
		await first
		const actor = createActor(createJazzArchiveExportMachine(reader(graph)), {
			input: { request }
		}).start()
		expect(await toPromise(actor)).toMatchObject({ outcome: 'failed', code: 'inUse' })
		expect(reads).not.toHaveBeenCalled()
		expect(input.value.handoff.dispatch).not.toHaveBeenCalled()
		expect(request.release()).toBe(first)
	})
	it('retained release drains a late capture call after owner stop before rolling back', async () => {
		const graph = await seed(),
			transaction = observeTransaction(),
			reached = deferred<void>(),
			resume = deferred<void>(),
			pending = deferred<never[]>()
		let capture: JazzArchiveReaderInput | undefined
		const h = start(graph, options(graph), (input) => {
			capture = input
			reached.resolve()
			return resume.promise
		})
		await reached.promise
		if (!capture) throw new Error('Capture capabilities missing')
		vi.spyOn(transaction(), 'all').mockImplementationOnce(() => pending.promise)
		const rollback = vi.spyOn(transaction(), 'rollback')
		const late = capture.all(app.workspaces.where({ id: graph.workspace })).then(
			() => 'ready',
			() => 'revoked'
		)
		try {
			h.actor.stop()
			const released = h.request.release()
			expect(h.request.release()).toBe(released)
			await new Promise<void>((resolve) => setImmediate(resolve))
			expect(rollback).not.toHaveBeenCalled()
			pending.resolve([])
			await released
			expect(await late).toBe('revoked')
			expect(rollback).toHaveBeenCalledTimes(1)
			expect(h.files).toHaveLength(0)
		} finally {
			pending.resolve([])
			resume.resolve()
			await h.request.release()
		}
	})
	it.each(['unconfirmed', 'rejected'])(
		'keeps %s rollback as cleanup failure without retrying',
		async (kind) => {
			const graph = await seed(),
				transaction = observeTransaction(),
				reached = deferred<void>(),
				resume = deferred<void>()
			const h = start(graph, options(graph), () => {
				reached.resolve()
				return resume.promise
			})
			await reached.promise
			const tx = transaction(),
				rollback = vi.spyOn(tx, 'rollback')
			if (kind === 'unconfirmed') rollback.mockResolvedValueOnce(false)
			else rollback.mockRejectedValueOnce(new Error('Synthetic native rollback failure'))
			try {
				h.actor.send({ type: 'CANCEL' })
				expect(await toPromise(h.actor)).toMatchObject({ outcome: 'failed', code: 'cleanupFailed' })
				const released = h.request.release()
				await expect(released).rejects.toThrow('cleanupFailed')
				expect(h.request.release()).toBe(released)
				expect(rollback).toHaveBeenCalledTimes(1)
				expect(h.files).toHaveLength(0)
			} finally {
				rollback.mockRestore()
				await tx.rollback()
				resume.resolve()
			}
		}
	)
	it('revokes capture capabilities before the preparation state runs', async () => {
		const graph = await seed(),
			prepare = payloadCodec.prepareArchivePayload
		let capture: JazzArchiveReaderInput | undefined,
			revoked = false
		vi.spyOn(payloadCodec, 'prepareArchivePayload').mockImplementation((...args) => {
			if (!capture) throw new Error('Capture capabilities missing')
			try {
				void capture.all(app.workspaces.where({ id: graph.workspace })).catch(() => {})
			} catch {
				revoked = true
			}
			return prepare(...args)
		})
		const h = start(graph, options(graph), async (input) => {
			capture = input
		})
		expect(await toPromise(h.actor)).toMatchObject({ outcome: 'exported' })
		expect(revoked).toBe(true)
	})
	it('rejects duplicate owners without releasing or replaying the active export', async () => {
		const graph = await seed(),
			reached = deferred<void>(),
			resume = deferred<void>()
		const h = start(graph, options(graph), () => {
			reached.resolve()
			return resume.promise
		})
		await reached.promise
		const machine = createJazzArchiveExportMachine(reader(graph))
		const duplicate = createActor(machine, { input: { request: h.request } }).start()
		expect(await toPromise(duplicate)).toMatchObject({ outcome: 'failed', code: 'inUse' })
		expect(h.actor.getSnapshot().status).toBe('active')
		resume.resolve()
		expect(await toPromise(h.actor)).toMatchObject({ outcome: 'exported' })
		const replay = createActor(machine, { input: { request: h.request } }).start()
		expect(await toPromise(replay)).toMatchObject({ outcome: 'failed', code: 'inUse' })
		expect(h.value.handoff.dispatch).toHaveBeenCalledTimes(1)
	})
	it('admits exactly one of two concurrent starts for the same request', async () => {
		const graph = await seed(),
			input = options(graph)
		const request = prepareJazzArchiveExport(input.value)
		const machine = createJazzArchiveExportMachine(reader(graph))
		const first = createActor(machine, { input: { request } }).start()
		const second = createActor(machine, { input: { request } }).start()
		const results = await Promise.all([toPromise(first), toPromise(second)])
		expect(results).toMatchObject([{ outcome: 'exported' }, { outcome: 'failed', code: 'inUse' }])
		expect(input.value.handoff.dispatch).toHaveBeenCalledTimes(1)
	})
	it('refuses duplicate handoffs while dispatching and after release', async () => {
		const graph = await seed(),
			input = options(graph),
			started = deferred<void>(),
			finish = deferred<void>()
		input.value.handoff.dispatch.mockImplementation(async () => {
			started.resolve()
			await finish.promise
			return 'dispatched'
		})
		const h = start(graph, input)
		await started.promise
		const failure = () => requestJazzExportHandoff(h.request).catch(classifyJazzArchiveFailure)
		expect(await failure()).toBe('inUse')
		finish.resolve()
		expect(await toPromise(h.actor)).toMatchObject({ outcome: 'exported', handoff: 'dispatched' })
		expect(await failure()).toBe('inUse')
		expect(input.value.handoff.dispatch).toHaveBeenCalledTimes(1)
	})
	it('records an unknown receipt and releases borrowed bytes when the provider throws', async () => {
		const graph = await seed(),
			input = options(graph)
		let borrowed: ArchiveHandoffFile | undefined
		input.value.handoff.dispatch.mockImplementation(async (file) => {
			borrowed = file
			throw new Error('synthetic-private-provider-error')
		})
		const h = start(graph, input)
		expect(await toPromise(h.actor)).toMatchObject({
			outcome: 'failed',
			code: 'failed',
			archiveProduced: true,
			handoff: 'unknown'
		})
		expect(input.value.handoff.dispatch).toHaveBeenCalledTimes(1)
		expect(() => borrowed?.copyBytes()).toThrow('resourceReleased')
		expect(JSON.stringify(h.actor.getSnapshot())).not.toContain('synthetic-private-provider-error')
		await expect(h.request.release()).resolves.toBeUndefined()
	})
	it('rejects a domain-invalid payload before issuing a native commit or handoff', async () => {
		const graph = await seed(),
			input = options(graph)
		const transaction = observeTransaction()
		let commit: MockInstance<Transaction<'exclusive'>['commit']> | undefined
		const prepare = payloadCodec.prepareArchivePayload
		let encoded: Uint8Array | undefined
		vi.spyOn(payloadCodec, 'prepareArchivePayload').mockImplementation((...args) => {
			const prepared = prepare(...args)
			encoded = prepared.bytes
			return prepared
		})
		input.value.profile = { ...profile, validate: () => false }
		const h = start(graph, input, async () => {
			commit = vi.spyOn(transaction(), 'commit')
		})
		expect(await toPromise(h.actor)).toMatchObject({
			outcome: 'failed',
			code: 'invalidData',
			archiveProduced: false,
			handoff: 'notStarted'
		})
		expect(h.files).toHaveLength(0)
		expect(encoded?.every((byte) => byte === 0)).toBe(true)
		expect(commit).toBeDefined()
		expect(commit).not.toHaveBeenCalled()
	})
	it('rejects a different authenticated identity before reading', async () => {
		const graph = await seed(),
			input = options(graph)
		const reads = vi.spyOn(db, 'all')
		input.value.binding.identityId = crypto.randomUUID()
		const h = start(graph, input)
		expect(await toPromise(h.actor)).toMatchObject({
			outcome: 'failed',
			code: 'permissionDenied',
			archiveProduced: false
		})
		expect(h.files).toHaveLength(0)
		expect(reads).not.toHaveBeenCalled()
	})
	it('discards a captured view when native read permission is revoked', async () => {
		const graph = await seed(),
			reached = deferred<void>(),
			resume = deferred<void>()
		const h = start(graph, options(graph), () => {
			reached.resolve()
			return resume.promise
		})
		await reached.promise
		await writer
			.update(app.workspaces, graph.workspace, { visible: false })
			.wait({ tier: 'global' })
		resume.resolve()
		expect(await toPromise(h.actor)).toMatchObject({ outcome: 'failed', archiveProduced: false })
		expect(h.files).toHaveLength(0)
	})
	it.each(['rejected', 'unknown'] satisfies ArchiveHandoffObservation[])(
		'preserves the %s handoff result without automatic replay',
		async (observation) => {
			const graph = await seed(),
				input = options(graph)
			input.value.handoff.dispatch.mockResolvedValue(observation)
			const h = start(graph, input)
			expect(await toPromise(h.actor)).toMatchObject({
				outcome: 'failed',
				archiveProduced: true,
				handoff: observation
			})
			expect(input.value.handoff.dispatch).toHaveBeenCalledTimes(1)
		}
	)
	it.each(['none', 'password'])(
		'prepares %s protection once and independently reopens exact source bytes',
		async (kind) => {
			const preparation = vi.spyOn(payloadCodec, 'prepareArchivePayload')
			const parsing = vi.spyOn(payloadCodec, 'parseArchivePayload')
			const graph = await seed(),
				before = await readGraph(db, graph)
			const h = start(
				graph,
				options(
					graph,
					kind === 'password'
						? { kind: 'password', password: 'synthetic-private-password' }
						: { kind: 'none' }
				)
			)
			expect(await toPromise(h.actor)).toMatchObject({
				outcome: 'exported',
				archiveProduced: true,
				handoff: 'dispatched'
			})
			expect(preparation).toHaveBeenCalledTimes(1)
			expect(parsing).not.toHaveBeenCalled()
			const file = h.files[0]
			if (!file) throw new Error('Missing dispatched file')
			const opened = createActor(createArchiveEnvelopeMachine(), {
				input: {
					request: prepareArchiveOpen(
						file,
						kind === 'password' ? 'synthetic-private-password' : undefined
					)
				}
			}).start()
			const result = await toPromise(opened)
			if (result.outcome !== 'integrityChecked') throw new Error('Independent reopen failed')
			expect(parsing).toHaveBeenCalledTimes(1)
			expect(result.archive.readPayload().attachments[0]?.data).toBe(
				Buffer.from(bytes(0)).toString('base64')
			)
			result.archive.release()
			expect(await readGraph(db, graph)).toEqual(before)
			expect(JSON.stringify(h.actor.getSnapshot())).not.toMatch(
				/synthetic-private-password|private-native-file/
			)
			await h.request.release()
		}
	)
	it.each(['CANCEL', 'SHUTDOWN', 'INVALIDATE'] satisfies ('CANCEL' | 'SHUTDOWN' | 'INVALIDATE')[])(
		'drains issued protection crypto before %s completes',
		async (type) => {
			const graph = await seed(),
				entered = deferred<void>(),
				finish = deferred<void>()
			const native = crypto.subtle.deriveKey.bind(crypto.subtle)
			let settled = false
			vi.spyOn(crypto.subtle, 'deriveKey').mockImplementationOnce((...args) => {
				const result = native(...args)
				entered.resolve()
				return finish.promise
					.then(() => result)
					.finally(() => {
						settled = true
					})
			})
			const h = start(
				graph,
				options(graph, { kind: 'password', password: 'private-drain-password' })
			)
			try {
				await entered.promise
				h.actor.send({ type })
				// Let a premature cleanup finish; crypto remains held by the explicit native barrier.
				await new Promise<void>((resolve) => setImmediate(resolve))
				expect(settled).toBe(false)
				expect(h.actor.getSnapshot().matches({ working: 'protecting' })).toBe(true)
				expect(h.actor.getSnapshot().status).toBe('active')
				expect(h.value.handoff.dispatch).not.toHaveBeenCalled()
				expect(JSON.stringify(h.actor.getPersistedSnapshot())).not.toMatch(
					/private-drain-password|private-native-file/
				)
				finish.resolve()
				expect(await toPromise(h.actor)).toMatchObject({
					outcome: type === 'CANCEL' ? 'cancelled' : type === 'SHUTDOWN' ? 'closed' : 'invalidated',
					archiveProduced: false,
					handoff: 'notStarted'
				})
				expect(settled).toBe(true)
				expect(h.files).toHaveLength(0)
			} finally {
				finish.resolve()
				await toPromise(h.actor)
				await h.request.release()
			}
		}
	)
	it('discards a conflicting capture and succeeds only after a fresh attempt', async () => {
		const graph = await seed(),
			reached = deferred<void>(),
			resume = deferred<void>()
		const h = start(graph, options(graph), () => {
			reached.resolve()
			return resume.promise
		})
		await reached.promise
		await writer.update(app.workspaces, graph.workspace, { revision: 1 }).wait({ tier: 'global' })
		resume.resolve()
		expect(await toPromise(h.actor)).toMatchObject({
			outcome: 'failed',
			code: 'sourceChanged',
			handoff: 'notStarted'
		})
		expect(h.files).toHaveLength(0)
		const fresh = start(graph)
		expect(await toPromise(fresh.actor)).toMatchObject({ outcome: 'exported' })
	})
	it.each(['CANCEL', 'SHUTDOWN', 'INVALIDATE'] satisfies ('CANCEL' | 'SHUTDOWN' | 'INVALIDATE')[])(
		'cleans the read transaction after %s without blocking ordinary writes',
		async (type) => {
			const graph = await seed(),
				reached = deferred<void>(),
				resume = deferred<void>()
			const h = start(graph, options(graph), () => {
				reached.resolve()
				return resume.promise
			})
			await reached.promise
			h.actor.send({ type })
			expect(await toPromise(h.actor)).toMatchObject({
				outcome: type === 'CANCEL' ? 'cancelled' : type === 'SHUTDOWN' ? 'closed' : 'invalidated'
			})
			resume.resolve()
			await db.update(app.workspaces, graph.workspace, { revision: 2 }).wait({ tier: 'global' })
			expect(h.files).toHaveLength(0)
		}
	)
	it('drains a late hydration read after cancellation', async () => {
		const graph = await seed(),
			pending = deferred<never[]>()
		const call = vi.spyOn(db, 'all').mockImplementationOnce(() => pending.promise)
		const h = start(graph)
		await vi.waitFor(() => expect(call).toHaveBeenCalled())
		h.actor.send({ type: 'CANCEL' })
		expect(h.actor.getSnapshot().status).toBe('active')
		pending.resolve([])
		expect(await toPromise(h.actor)).toMatchObject({ outcome: 'cancelled' })
		call.mockRestore()
		expect(h.files).toHaveLength(0)
	})
	it('releases native ownership after an unexpected reader crash', async () => {
		const graph = await seed(),
			h = start(graph, options(graph), undefined, true)
		expect(await toPromise(h.actor)).toMatchObject({ outcome: 'failed', code: 'failed' })
		await h.request.release()
		await db.update(app.workspaces, graph.workspace, { revision: 3 }).wait({ tier: 'global' })
		expect(h.files).toHaveLength(0)
	})
	it('handles cancellation before the claim completes', async () => {
		const graph = await seed(),
			h = start(graph)
		h.actor.send({ type: 'CANCEL' })
		expect(await toPromise(h.actor)).toMatchObject({ outcome: 'cancelled', archiveProduced: false })
	})
	it('discards stale binding before native commit', async () => {
		const graph = await seed(),
			reached = deferred<void>(),
			resume = deferred<void>(),
			input = options(graph)
		let current = true
		input.value.isCurrent = () => current
		const h = start(graph, input, () => {
			reached.resolve()
			return resume.promise
		})
		await reached.promise
		current = false
		resume.resolve()
		expect(await toPromise(h.actor)).toMatchObject({
			outcome: 'failed',
			code: 'sourceChanged',
			archiveProduced: false
		})
		expect(h.files).toHaveLength(0)
	})
	it('abrupt stop releases the transaction without asking the stopped reader', async () => {
		const graph = await seed(),
			reached = deferred<void>(),
			resume = deferred<void>()
		const h = start(graph, options(graph), () => {
			reached.resolve()
			return resume.promise
		})
		await reached.promise
		h.actor.stop()
		await h.request.release()
		resume.resolve()
		expect(h.files).toHaveLength(0)
	})
	it('keeps cleanup ownership when the export owner itself errors', async () => {
		const graph = await seed(),
			input = options(graph)
		input.value.profile = {
			...profile,
			validate: () => {
				throw new Error('Synthetic profile failure')
			}
		}
		const request = prepareJazzArchiveExport(input.value)
		const machine = createJazzArchiveExportMachine(reader(graph)).provide({
			actions: {
				fail: () => {
					throw new Error('Synthetic owner crash')
				}
			}
		})
		const actor = createActor(machine, { input: { request } })
		const terminal = toPromise(actor)
		actor.start()
		await expect(terminal).rejects.toThrow('Synthetic owner crash')
		await request.release()
		expect(input.files).toHaveLength(0)
	})
	it('retains the native verdict during offline cancellation while ordinary saves still work', async () => {
		const graph = await seed(),
			reached = deferred<void>(),
			resume = deferred<void>()
		const h = start(
			graph,
			options(graph, { kind: 'password', password: 'synthetic-private-password' }),
			() => {
				reached.resolve()
				return resume.promise
			}
		)
		await reached.promise
		await db.disconnect()
		try {
			resume.resolve()
			await waitFor(h.actor, (snapshot) => snapshot.matches({ working: 'confirming' }))
			h.actor.send({ type: 'CANCEL' })
			await db.update(app.workspaces, graph.workspace, { revision: 4 }).wait({ tier: 'local' })
			expect(h.actor.getSnapshot().status).toBe('active')
			expect(JSON.stringify(h.actor.getSnapshot())).not.toContain('synthetic-private-password')
		} finally {
			await db.reconnect()
		}
		expect(await toPromise(h.actor)).toMatchObject({ outcome: 'cancelled', archiveProduced: false })
		expect(h.files).toHaveLength(0)
	})
	it('keeps an issued handoff alive until settlement and preserves its actual dispatch receipt', async () => {
		const graph = await seed(),
			input = options(graph),
			started = deferred<void>(),
			finish = deferred<void>()
		let borrowed: ArchiveHandoffFile | undefined
		input.value.handoff.dispatch.mockImplementation(async (file) => {
			borrowed = file
			started.resolve()
			await finish.promise
			return 'dispatched'
		})
		const h = start(graph, input)
		await started.promise
		h.actor.send({ type: 'CANCEL' })
		expect(borrowed?.copyBytes().length).toBeGreaterThan(0)
		finish.resolve()
		expect(await toPromise(h.actor)).toMatchObject({
			outcome: 'cancelled',
			handoff: 'dispatched',
			archiveProduced: true
		})
		expect(() => borrowed?.copyBytes()).toThrow('resourceReleased')
	})
	it('retains a pending handoff after export stop and joins repeated release', async () => {
		const graph = await seed(),
			input = options(graph),
			started = deferred<void>(),
			finish = deferred<void>()
		let borrowed: ArchiveHandoffFile | undefined
		input.value.handoff.dispatch.mockImplementation(async (file) => {
			borrowed = file
			started.resolve()
			await finish.promise
			return 'dispatched'
		})
		const h = start(graph, input)
		await started.promise
		h.actor.stop()
		const released = h.request.release()
		expect(h.request.release()).toBe(released)
		let settled = false
		void released.then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(settled).toBe(false)
		expect(borrowed?.copyBytes().length).toBeGreaterThan(0)
		finish.resolve()
		await released
		expect(jazzExportFacts(h.request)).toMatchObject({
			archiveProduced: true,
			handoff: 'dispatched'
		})
		expect(() => borrowed?.copyBytes()).toThrow('resourceReleased')
		expect(input.value.handoff.dispatch).toHaveBeenCalledTimes(1)
	})
})
