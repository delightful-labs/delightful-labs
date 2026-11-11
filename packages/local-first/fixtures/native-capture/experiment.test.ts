import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db, Transaction } from 'jazz-tools'
import { app, permissions, bytes, readGraph, type Graph } from './schema.js'
import { createJazzClient, type JazzClient } from 'jazz-tools/backend'
import { startTestJazz, type TestJazz } from 'jazz-tools/testing'
import type { JazzSession } from 'jazz-tools/client'
import { chromium, type Browser } from '@playwright/test'
import { createServer, searchForWorkspaceRoot, type ViteDevServer } from 'vite'
import { jazzFixtureAssets } from '../test-app/jazz-vite.js'
import { resolve } from 'node:path'

type BrowserLab = {
	module: typeof import('./schema.js')
	session: Awaited<ReturnType<typeof import('./schema.js').createBrowserSession>>
	db: Db
	tx: Transaction<'serializable'> | undefined
}
declare global {
	interface Window {
		NativeCaptureExperiment: BrowserLab
		NativeCaptureModule: typeof import('./schema.js')
	}
}

type NativeObservation<Value> =
	| { outcome: 'resolved'; value: Value }
	| { outcome: 'rejected'; message: string }
	| { outcome: 'pending' }
const transactions = new Set<Transaction>()
const sessions: JazzSession<JazzClient>[] = []
let server: TestJazz | undefined
let reader: Db
let writer: Db
let web: ViteDevServer | undefined
let browser: Browser | undefined
let browserURL: string

function record(name: string, facts: object) {
	console.info(JSON.stringify({ experiment: name, ...facts }))
}
function transaction(kind: 'serializable', db?: Db): Transaction<'serializable'>
function transaction(kind: 'mergeable', db?: Db): Transaction<'mergeable'>
function transaction(kind: 'serializable' | 'mergeable', db?: Db): Transaction
function transaction(kind: 'serializable' | 'mergeable', db = reader) {
	const tx = kind === 'serializable' ? db.beginSerializableTransaction() : db.beginTransaction()
	transactions.add(tx)
	return tx
}
async function release(tx: Transaction) {
	try {
		return await tx.rollback()
	} finally {
		transactions.delete(tx)
	}
}
async function seed(): Promise<Graph> {
	const graph = {
		workspace: crypto.randomUUID(),
		entry: crypto.randomUUID(),
		file: crypto.randomUUID(),
		part: crypto.randomUUID()
	}
	const tx = transaction('mergeable', writer)
	try {
		tx.insert(
			app.workspaces,
			{ revision: 0, allowed: true, visible: true },
			{ id: graph.workspace }
		)
		tx.insert(
			app.entries,
			{ workspaceId: graph.workspace, fileId: graph.file, revision: 0 },
			{ id: graph.entry }
		)
		tx.insert(
			app.files,
			{ workspaceId: graph.workspace, revision: 0, sizeBytes: 8 },
			{ id: graph.file }
		)
		tx.insert(
			app.parts,
			{ workspaceId: graph.workspace, fileId: graph.file, partIndex: 0, data: bytes(0) },
			{ id: graph.part }
		)
		await tx.commit().wait({ tier: 'global' })
		transactions.delete(tx)
		return graph
	} catch (error) {
		await release(tx)
		throw error
	}
}
async function change(graph: Graph, revision: number, db = writer, allowed = true) {
	const tx = transaction('mergeable', db)
	try {
		tx.update(app.workspaces, graph.workspace, { revision, allowed })
		tx.update(app.entries, graph.entry, { revision })
		tx.update(app.files, graph.file, { revision })
		tx.update(app.parts, graph.part, { data: bytes(revision) })
		const write = tx.commit()
		transactions.delete(tx)
		return write
	} catch (error) {
		await release(tx)
		throw error
	}
}
async function observe<Value>(
	promise: PromiseLike<Value>,
	milliseconds = 2500
): Promise<NativeObservation<Value>> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			Promise.resolve(promise).then(
				(value): NativeObservation<Value> => ({ outcome: 'resolved', value }),
				(error: unknown): NativeObservation<Value> => ({
					outcome: 'rejected',
					message: error instanceof Error ? error.message : String(error)
				})
			),
			new Promise<{ outcome: 'pending' }>((resolve) => {
				timer = setTimeout(() => resolve({ outcome: 'pending' }), milliseconds)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}

function auditGraph(db: Db, graph: Graph) {
	return Promise.all([
		db.all(
			app.workspaces
				.where({ id: graph.workspace })
				.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt'),
			{ tier: 'remote' }
		),
		db.all(
			app.entries
				.where({ workspaceId: graph.workspace })
				.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt'),
			{ tier: 'remote' }
		),
		db.all(
			app.files
				.where({ workspaceId: graph.workspace })
				.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt'),
			{ tier: 'remote' }
		),
		db.all(
			app.parts
				.where({ workspaceId: graph.workspace })
				.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt'),
			{ tier: 'remote' }
		)
	])
}

beforeAll(async () => {
	web = await createServer({
		configFile: false,
		...jazzFixtureAssets(),
		root: resolve('fixtures/native-capture'),
		cacheDir: resolve('node_modules/.vite/native-capture'),
		plugins: [
			{
				name: 'experiment-document',
				configureServer(host) {
					host.middlewares.use((request, response, next) => {
						if (request.url !== '/') return next()
						response.setHeader('Content-Type', 'text/html')
						response.end(
							'<!doctype html><title>Disposable native snapshot experiment</title><script type="module">import * as experiment from "/schema.ts"; window.NativeCaptureModule = experiment;</script>'
						)
					})
				}
			}
		],
		server: {
			host: '127.0.0.1',
			port: 0,
			strictPort: true,
			fs: { allow: [searchForWorkspaceRoot(process.cwd())] }
		}
	})
	await web.listen()
	const address = web.httpServer?.address()
	if (!address || typeof address === 'string') throw new Error('Missing disposable web listener')
	browserURL = `http://127.0.0.1:${address.port}/`
	process.stdout.write(`Disposable browser experiment: ${browserURL}\n`)
	server = await startTestJazz({
		app,
		permissions,
		jazz: { allowedOrigins: [new URL(browserURL).origin] }
	})
	console.info(`Disposable native-capture server: ${server.url}`)
	const session = await createJazzClient({
		appId: server.appId,
		app,
		permissions,
		serverUrl: server.url,
		driver: { type: 'memory' },
		env: 'native-capture-experiment',
		initial: 'local-first'
	})
	sessions.push(session)
	const readerSnapshot = session.getSnapshot()
	if (readerSnapshot.status !== 'ready' || !readerSnapshot.client)
		throw new Error('Disposable client startup failed')
	reader = readerSnapshot.client.db
	writer = server.jazz.db
	reader.onMutationError(() => {})
})
afterAll(async () => {
	for (const tx of transactions) await observe(tx.rollback())
	for (const session of sessions) await observe(session.close())
	await browser?.close()
	await web?.close()
	await server?.stop()
})

describe('native snapshot export feasibility', () => {
	it('control: ordinary remote queries can mix two committed graph versions', async () => {
		const graph = await seed()
		const root = await reader.one(app.workspaces.where({ id: graph.workspace }), { tier: 'remote' })
		await (await change(graph, 1)).wait({ tier: 'global' })
		const after = await readGraph(reader, graph)
		record('ordinary-queries-control', { firstRoot: root?.revision, after })
		expect(root?.revision).toBe(0)
		expect(after.versions).toEqual([1, 1, 1, 1])
	})
	it.each(['serializable', 'mergeable'] satisfies ('serializable' | 'mergeable')[])(
		'%s transaction: remote reads follow its documented isolation across a second client commit',
		async (kind) => {
			const graph = await seed()
			expect((await readGraph(reader, graph)).versions).toEqual([0, 0, 0, 0])
			const tx = transaction(kind)
			try {
				const root = await tx.one(app.workspaces.where({ id: graph.workspace }), { tier: 'remote' })
				await (await change(graph, 1)).wait({ tier: 'global' })
				const live = await readGraph(reader, graph)
				const frozen = await observe(readGraph(tx, graph))
				record(`${kind}-warm-concurrent`, { firstRoot: root?.revision, live, frozen })
				expect(live.versions).toEqual([1, 1, 1, 1])
				const capturedRevision = kind === 'serializable' ? 0 : 1
				expect(frozen).toMatchObject({
					outcome: 'resolved',
					value: {
						versions: [capturedRevision, capturedRevision, capturedRevision, capturedRevision],
						bytes: [Array.from(bytes(capturedRevision))]
					}
				})
			} finally {
				await release(tx)
			}
		}
	)
	it('serializable remote reads hydrate a complete cold snapshot without changing its point in time', async () => {
		const graph = await seed()
		const tx = transaction('serializable')
		try {
			const root = await tx.one(app.workspaces.where({ id: graph.workspace }), { tier: 'remote' })
			const frozen = await observe(readGraph(tx, graph))
			const hydrated = await readGraph(reader, graph)
			const oldAfterHydration = await readGraph(tx, graph)
			const fresh = transaction('serializable')
			let newlyOpened
			try {
				newlyOpened = await readGraph(fresh, graph)
			} finally {
				await release(fresh)
			}
			record('exclusive-cold-coverage', {
				firstRoot: root?.revision,
				frozen,
				hydrated,
				oldAfterHydration,
				newlyOpened
			})
			expect(frozen).toMatchObject({
				outcome: 'resolved',
				value: { counts: [1, 1, 1, 1], versions: [0, 0, 0, 0] }
			})
			expect(hydrated.counts).toEqual([1, 1, 1, 1])
			expect(oldAfterHydration).toEqual(hydrated)
			expect(newlyOpened?.counts).toEqual([1, 1, 1, 1])
		} finally {
			await release(tx)
		}
	})
	it('serializable read-only commit: wait resolves and application rows stay unchanged', async () => {
		const graph = await seed(),
			before = await readGraph(reader, graph)
		const beforeAudit = structuredClone(await auditGraph(reader, graph))
		const tx = transaction('serializable')
		try {
			await readGraph(tx, graph)
			const write = tx.commit()
			transactions.delete(tx)
			const commit = await observe(write.txId),
				wait = await observe(write.wait())
			const after = await readGraph(writer, graph)
			record('read-only-commit', {
				commit,
				wait,
				unchanged: JSON.stringify(before) === JSON.stringify(after)
			})
			expect(wait).toMatchObject({ outcome: 'resolved' })
			expect(after).toEqual(before)
			expect(await auditGraph(writer, graph)).toEqual(beforeAudit)
		} finally {
			if (transactions.has(tx)) await release(tx)
		}
	})
	it('a snapshot also isolates ordinary writes from the same client', async () => {
		const graph = await seed()
		await readGraph(reader, graph)
		const tx = transaction('serializable')
		try {
			await tx.one(app.workspaces.where({ id: graph.workspace }), { tier: 'remote' })
			await (await change(graph, 3, reader)).wait({ tier: 'global' })
			const live = await readGraph(reader, graph),
				frozen = await readGraph(tx, graph)
			record('same-client-writer', { live, frozen })
			expect(live.versions).toEqual([3, 3, 3, 3])
			expect(frozen.versions).toEqual([0, 0, 0, 0])
		} finally {
			await release(tx)
		}
	})
	it('a snapshot retains deleted children and excludes newly inserted children', async () => {
		const graph = await seed()
		await readGraph(reader, graph)
		const tx = transaction('serializable'),
			nextEntry = crypto.randomUUID()
		try {
			await tx.one(app.workspaces.where({ id: graph.workspace }), { tier: 'remote' })
			const update = transaction('mergeable', writer)
			try {
				update.delete(app.entries, graph.entry)
				update.insert(
					app.entries,
					{ workspaceId: graph.workspace, fileId: graph.file, revision: 4 },
					{ id: nextEntry }
				)
				await update.commit().wait({ tier: 'global' })
				transactions.delete(update)
			} finally {
				if (transactions.has(update)) await release(update)
			}
			const live = await reader.all(app.entries.where({ workspaceId: graph.workspace }), {
				tier: 'remote'
			})
			const frozen = await tx.all(app.entries.where({ workspaceId: graph.workspace }), {
				tier: 'remote'
			})
			record('insert-delete', {
				liveVersions: live.map((row) => row.revision),
				frozenVersions: frozen.map((row) => row.revision)
			})
			expect(live.map((row) => row.id)).toEqual([nextEntry])
			expect(frozen.map((row) => row.id)).toEqual([graph.entry])
		} finally {
			await release(tx)
		}
	})
	it.each([true, false])(
		'captures pending offline edits whose later acceptance is %s',
		async (accepted) => {
			const graph = await seed()
			await readGraph(reader, graph)
			await reader.disconnect()
			let tx: Transaction | undefined
			try {
				const write = await change(graph, 5, reader, accepted)
				await write.wait({ tier: 'local' })
				const beforeReconnect = await observe(write.wait({ tier: 'global' }), 100)
				tx = transaction('serializable')
				const local = await observe(readGraph(tx, graph, 'local-first'))
				const remote = await observe(readGraph(tx, graph, 'remote'), 250)
				await reader.reconnect()
				const settlement = await observe(write.wait({ tier: 'global' }))
				const live = await readGraph(reader, graph)
				const snapshotAfterSettlement = await observe(readGraph(tx, graph, 'local-first'))
				record(`pending-${accepted ? 'accepted' : 'rejected'}`, {
					beforeReconnect,
					local,
					remote,
					settlement,
					live,
					snapshotAfterSettlement
				})
				expect(beforeReconnect.outcome).toBe('pending')
				expect(local).toMatchObject({ outcome: 'resolved', value: { versions: [5, 5, 5, 5] } })
				expect(settlement.outcome).toBe(accepted ? 'resolved' : 'rejected')
				expect(live.versions).toEqual(accepted ? [5, 5, 5, 5] : [0, 0, 0, 0])
			} finally {
				await reader.reconnect()
				if (tx) await release(tx)
			}
		}
	)
	it('bounded byte ranges come from one snapshot across a concurrent byte replacement', async () => {
		const graph = await seed()
		await readGraph(reader, graph)
		const tx = transaction('serializable')
		try {
			const head = await tx.all(
				app.parts.where({ id: graph.part }).select({ data: { from: 0, to: 4 } }),
				{ tier: 'remote' }
			)
			await (await change(graph, 6)).wait({ tier: 'global' })
			await readGraph(reader, graph)
			const tail = await tx.all(
				app.parts.where({ id: graph.part }).select({ data: { from: 4, to: 8 } }),
				{ tier: 'remote' }
			)
			const assembled = [
				...head.flatMap((row) => Array.from(row.data)),
				...tail.flatMap((row) => Array.from(row.data))
			]
			record('bounded-byte-ranges', { assembled })
			expect(assembled).toEqual(Array.from(bytes(0)))
		} finally {
			await release(tx)
		}
	})
	it('observes current read access separately from snapshot read access after permission changes', async () => {
		const graph = await seed()
		await readGraph(reader, graph)
		const tx = transaction('serializable')
		try {
			const first = await tx.one(app.workspaces.where({ id: graph.workspace }), { tier: 'remote' })
			await writer
				.update(app.workspaces, graph.workspace, { visible: false })
				.wait({ tier: 'global' })
			const live = await reader.one(app.workspaces.where({ id: graph.workspace }), {
				tier: 'remote'
			})
			const frozen = await observe(
				tx.one(app.workspaces.where({ id: graph.workspace }), { tier: 'remote' })
			)
			const write = tx.commit()
			transactions.delete(tx)
			const verdict = await observe(write.wait())
			record('read-permission-change', {
				first: first?.revision,
				liveVisible: live !== null,
				frozen,
				verdict
			})
			expect(first?.revision).toBe(0)
			expect(live).toBeNull()
			expect(verdict.outcome).toBe('rejected')
		} finally {
			if (transactions.has(tx)) await release(tx)
		}
	})
	it('observes read-only serializable acceptance after a conflicting concurrent change', async () => {
		const graph = await seed()
		await readGraph(reader, graph)
		const tx = transaction('serializable')
		try {
			await readGraph(tx, graph)
			await (await change(graph, 7)).wait({ tier: 'global' })
			await readGraph(reader, graph)
			const write = tx.commit()
			transactions.delete(tx)
			const wait = await observe(write.wait())
			record('read-only-conflict', { wait })
			expect(wait.outcome).toBe('rejected')
		} finally {
			if (transactions.has(tx)) await release(tx)
		}
	})
	it('confirms a complete cold remote capture against the authority', async () => {
		const graph = await seed(),
			tx = transaction('serializable')
		try {
			const captured = await readGraph(tx, graph)
			const write = tx.commit()
			transactions.delete(tx)
			const wait = await observe(write.wait()),
				actual = await readGraph(writer, graph)
			record('cold-read-only-verdict', { captured, wait, actual })
			expect(captured).toEqual(actual)
			expect(actual.counts).toEqual([1, 1, 1, 1])
			expect(wait.outcome).toBe('resolved')
		} finally {
			if (transactions.has(tx)) await release(tx)
		}
	})
	it('records the serializable verdict for a new matching row outside the frozen result', async () => {
		const graph = await seed()
		await readGraph(reader, graph)
		const tx = transaction('serializable')
		try {
			const captured = await tx.all(app.entries.where({ workspaceId: graph.workspace }), {
				tier: 'remote'
			})
			await writer
				.insert(app.entries, { workspaceId: graph.workspace, fileId: graph.file, revision: 8 })
				.wait({ tier: 'global' })
			const live = await reader.all(app.entries.where({ workspaceId: graph.workspace }), {
				tier: 'remote'
			})
			const write = tx.commit()
			transactions.delete(tx)
			const wait = await observe(write.wait())
			record('matching-insert-verdict', {
				capturedRows: captured.length,
				liveRows: live.length,
				wait
			})
			expect(captured).toHaveLength(1)
			expect(live).toHaveLength(2)
			expect(wait.outcome).toBe('rejected')
		} finally {
			if (transactions.has(tx)) await release(tx)
		}
	})
	it('exclusive verdict rejects a graph mixed across optimistic-write rejection', async () => {
		const graph = await seed()
		await readGraph(reader, graph)
		await reader.disconnect()
		const pending = await change(graph, 9, reader, false)
		await pending.wait({ tier: 'local' })
		const tx = transaction('serializable')
		try {
			const root = await tx.one(app.workspaces.where({ id: graph.workspace }), {
				tier: 'local-first'
			})
			await reader.reconnect()
			const rejection = await observe(pending.wait({ tier: 'global' }))
			await readGraph(reader, graph)
			const entries = await tx.all(app.entries.where({ workspaceId: graph.workspace }), {
				tier: 'local-first'
			})
			const parts = await tx.all(app.parts.where({ workspaceId: graph.workspace }), {
				tier: 'local-first'
			})
			const write = tx.commit()
			transactions.delete(tx)
			const wait = await observe(write.wait())
			record('mixed-rejected-write-verdict', {
				capturedVersions: [root?.revision, entries[0]?.revision, parts[0]?.data[0]],
				rejection,
				wait
			})
			expect(rejection.outcome).toBe('rejected')
			expect(wait.outcome).toBe('rejected')
		} finally {
			await reader.reconnect()
			if (transactions.has(tx)) await release(tx)
		}
	})
	it.each([true, false])(
		'read-only serializable wait settles pending source writes accepted=%s',
		async (accepted) => {
			const graph = await seed()
			await readGraph(reader, graph)
			await reader.disconnect()
			const pending = await change(graph, 10, reader, accepted)
			await pending.wait({ tier: 'local' })
			const tx = transaction('serializable')
			try {
				const captured = await readGraph(tx, graph, 'local-first')
				const write = tx.commit()
				transactions.delete(tx)
				const beforeReconnect = await observe(write.wait(), 100)
				await reader.reconnect()
				const sourceVerdict = await observe(pending.wait({ tier: 'global' })),
					captureVerdict = await observe(write.wait())
				record(`source-dependency-${accepted ? 'accepted' : 'rejected'}`, {
					captured,
					beforeReconnect,
					sourceVerdict,
					captureVerdict
				})
				expect(captured.versions).toEqual([10, 10, 10, 10])
				expect(beforeReconnect.outcome).toBe('pending')
				expect(sourceVerdict.outcome).toBe(accepted ? 'resolved' : 'rejected')
				expect(captureVerdict.outcome).toBe(accepted ? 'resolved' : 'rejected')
				await readGraph(reader, graph)
				const retry = transaction('serializable')
				try {
					const capturedAfterSettlement = await readGraph(retry, graph)
					const result = retry.commit()
					transactions.delete(retry)
					const retryVerdict = await observe(result.wait())
					record(`source-dependency-${accepted ? 'accepted' : 'rejected'}-fresh-capture`, {
						capturedAfterSettlement,
						retryVerdict
					})
					expect(capturedAfterSettlement.versions).toEqual(
						accepted ? [10, 10, 10, 10] : [0, 0, 0, 0]
					)
					expect(retryVerdict.outcome).toBe('resolved')
				} finally {
					if (transactions.has(retry)) await release(retry)
				}
			} finally {
				await reader.reconnect()
				if (transactions.has(tx)) await release(tx)
			}
		}
	)
	it('persistent Chromium SharedWorker: snapshot isolation, conflict verdict, cold coverage and fresh capture', async () => {
		if (!server) throw new Error('Disposable authority missing')
		const url = browserURL
		browser = await chromium.launch({ headless: true, channel: 'chromium' })
		const context = await browser.newContext(),
			page = await context.newPage()
		try {
			await page.goto(url)
			await page.waitForFunction(() => Boolean(window.NativeCaptureModule))
			await page.evaluate(
				async (config) => {
					const module = window.NativeCaptureModule
					const session = await module.createBrowserSession({
						scope: config.appId,
						serverUrl: config.serverUrl,
						initial: 'local-first',
						client: module.loadLocalFirst,
						env: 'native-capture-experiment',
						driver: { type: 'persistent', dbName: 'disposable-native-capture' }
					})
					const client = session.getSnapshot().client
					if (!client) throw new Error('Browser native session startup failed')
					await client.db.upgradeToLocalFirst(module.loadLocalFirst)
					if (!client.db.isLocalFirst())
						throw new Error('Native experiment requires local-first storage')
					window.NativeCaptureExperiment = { module, session, db: client.db, tx: undefined }
				},
				{ appId: server.appId, serverUrl: server.url, moduleUrl: `${url}schema.ts` }
			)
			const graph = await seed()
			const first = await page.evaluate(async (graph) => {
				const lab = window.NativeCaptureExperiment
				const warmed = await lab.module.readGraph(lab.db, graph)
				lab.tx = lab.db.beginSerializableTransaction()
				const root = await lab.tx.one(lab.module.app.workspaces.where({ id: graph.workspace }), {
					tier: 'remote'
				})
				return { warmed, root: root?.revision }
			}, graph)
			await (await change(graph, 11)).wait({ tier: 'global' })
			const changed = await page.evaluate(async (graph) => {
				const lab = window.NativeCaptureExperiment
				if (!lab.tx) throw new Error('Browser transaction missing')
				const live = await lab.module.readGraph(lab.db, graph)
				const frozen = await lab.module.readGraph(lab.tx, graph)
				const write = lab.tx.commit()
				lab.tx = undefined
				let verdict = 'resolved'
				try {
					await write.wait()
				} catch {
					verdict = 'rejected'
				}
				return { live, frozen, verdict }
			}, graph)
			const fresh = await page.evaluate(async (graph) => {
				const lab = window.NativeCaptureExperiment,
					tx = lab.db.beginSerializableTransaction()
				const captured = await lab.module.readGraph(tx, graph)
				await tx.commit().wait()
				return captured
			}, graph)
			const coldGraph = await seed()
			const cold = await page.evaluate(async (graph) => {
				const lab = window.NativeCaptureExperiment,
					tx = lab.db.beginSerializableTransaction()
				const captured = await lab.module.readGraph(tx, graph)
				const write = tx.commit()
				let verdict = 'resolved'
				try {
					await write.wait()
				} catch {
					verdict = 'rejected'
				}
				await lab.module.readGraph(lab.db, graph)
				const next = lab.db.beginSerializableTransaction()
				const hydrated = await lab.module.readGraph(next, graph)
				await next.commit().wait()
				return { captured, verdict, hydrated }
			}, coldGraph)
			record('persistent-browser', { first, changed, fresh, cold })
			expect(first.warmed.versions).toEqual([0, 0, 0, 0])
			expect(changed.live.versions).toEqual([11, 11, 11, 11])
			expect(changed.frozen.versions).toEqual([0, 0, 0, 0])
			expect(changed.frozen.bytes).toEqual([Array.from(bytes(0))])
			expect(changed.verdict).toBe('rejected')
			expect(fresh.versions).toEqual([11, 11, 11, 11])
			expect(cold.captured.counts).toEqual([1, 1, 1, 1])
			expect(cold.verdict).toBe('resolved')
			expect(cold.hydrated.counts).toEqual([1, 1, 1, 1])
			await page.evaluate(async () => {
				const lab = window.NativeCaptureExperiment
				if (lab.tx) await lab.tx.rollback()
				await lab.session.close()
			})
		} finally {
			await context.close()
		}
	}, 60000)
})
