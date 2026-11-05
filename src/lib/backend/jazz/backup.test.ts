import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import {
	createExportReader as reader,
	testExportProfile as profile
} from '../../../../fixtures/native-capture/export-reader.js'
import { createJazzSession, type JazzClient } from 'jazz-tools/backend'
import { startLocalJazzServer, type LocalJazzServerHandle } from 'jazz-tools/testing'
import type { JazzSession } from 'jazz-tools/client'
import type { Db } from 'jazz-tools'
import {
	app,
	permissions,
	bytes,
	readGraph,
	type Graph
} from '../../../../fixtures/native-capture/schema.js'
import { prepareJazzArchiveExport, type JazzArchiveReaderInput } from './backup-api.js'
import { createJazzArchiveExportMachine } from '../../machines/backup/jazz-export.js'
import { createArchiveEnvelopeMachine } from '../../machines/backup/envelope.js'
import { prepareArchiveOpen, type ArchiveProtection } from '../../backup/envelope-api.js'
import type { ArchiveHandoffFile } from '../../backup/export.js'

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
				dispatch: vi.fn(async (file: ArchiveHandoffFile): Promise<'dispatched'> => {
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

describe('native Jazz archive export', () => {
	it.each(['none', 'password'])(
		'exports %s protection and independently reopens exact source bytes',
		async (kind) => {
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
			input = options(graph),
			request = prepareJazzArchiveExport(input.value)
		const machine = createJazzArchiveExportMachine(reader(graph, undefined, true)).provide({
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
})
