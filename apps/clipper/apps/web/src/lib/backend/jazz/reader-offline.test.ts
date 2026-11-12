import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createActor, toPromise } from 'xstate'
import { createJazz, createJazzClient, acceptLocalFirstAuth, sqlite } from 'jazz-tools/backend'
import type { BackendClientSession, JazzClientConfig } from 'jazz-tools/backend'
import { ReadTier } from 'jazz-tools'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import type { ReaderChange } from '../../reader/schema.js'

async function startAuthority(directory: string, port = 0) {
	const server = createServer((request, response) => backend.nodeHandler(request, response))
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, '127.0.0.1', resolve)
	})
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('Missing disposable authority port')
	const origin = `http://127.0.0.1:${address.port}`,
		serverUrl = `${origin}/jazz`
	const backend = createJazz({
		app,
		permissions,
		store: sqlite({ path: join(directory, 'authority') }),
		authenticate: acceptLocalFirstAuth,
		publicUrl: [serverUrl],
		allowedOrigins: [origin]
	})
	await backend.attach(server)
	await backend.ready()
	return {
		serverUrl,
		port: address.port,
		appId: backend.appId,
		stop: async () => {
			await backend.close()
			server.closeAllConnections()
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			)
		}
	}
}
it('reconciles concurrent offline progress after both replicas restart, retaining the latest backward resume location', async () => {
	const releases: (() => void)[] = []
	const directory = await mkdtemp(join(tmpdir(), 'clipper-reader-offline-'))
	let authority: Awaited<ReturnType<typeof startAuthority>> | undefined =
		await startAuthority(directory)
	const { serverUrl, appId, port } = authority
	let first: BackendClientSession | undefined,
		second: BackendClientSession | undefined,
		identity: string | null = null
	const config = (name: string): JazzClientConfig => ({
		app,
		permissions,
		serverUrl,
		appId,
		driver: { type: 'persistent', dataPath: join(directory, name) } satisfies {
			type: 'persistent'
			dataPath: string
		},
		initial: 'local-first' satisfies 'local-first',
		env: 'test' satisfies 'test',
		store: {
			read: async () => identity,
			update: async (transform: (current: string | null) => string) => {
				identity = transform(identity)
			}
		}
	})

	try {
		first = await createJazzClient(config('first'))
		const owner = first.getSnapshot().account?.id,
			firstDb = first.getSnapshot().client?.db
		if (!owner || !firstDb) throw new Error('Missing first replica')
		await firstDb
			.insert(app.libraries, { ownerId: owner, bootstrapVersion: '1' }, { id: owner })
			.wait({ tier: 'global' })
		const saved = await toPromise(
			createActor(createLibraryRecords(firstDb, owner, () => true).articles.saveMachine, {
				input: { url: 'https://example.com/reading' }
			}).start()
		)
		if (saved.kind !== 'saved') throw new Error('Expected saved Document')
		await Promise.all(saved.receipts.map((receipt) => receipt.global()))
		second = await createJazzClient(config('second'))
		expect(second.getSnapshot().account?.id).toBe(owner)
		const secondDb = second.getSnapshot().client?.db
		if (!secondDb) throw new Error('Missing second replica')
		await secondDb.one(app.libraries.where({ id: owner }), { tier: ReadTier.Remote })
		const query = app.libraryDocuments.where({ id: saved.operationId })
		expect(await secondDb.one(query, { tier: ReadTier.Remote })).toMatchObject({
			readingProgress: 0,
			resumePosition: null
		})
		await Promise.all([firstDb.disconnect(), secondDb.disconnect()])
		async function position(
			db: typeof firstDb,
			ownerId: string,
			progress: number,
			offset: number,
			interactedAt: Date
		) {
			if (!db) throw new Error('Missing replica')
			const id = crypto.randomUUID(),
				draft: ReaderChange = {
					documentId: saved.operationId,
					field: 'position',
					value: {
						version: 1,
						offset,
						quote: 'Reading',
						prefix: '',
						suffix: '',
						progress,
						interactedAt
					}
				}
			const result = await toPromise(
				createActor(createLibraryRecords(db, ownerId, () => true).reader.stage([]), {
					input: { attempt: { operationId: id, workspaceId: id, membershipId: id, draft } }
				}).start()
			)
			expect(result.settlement.kind).toBe('locallyPersisted')
		}
		const earlier = new Date('2026-11-12T12:00:00Z'),
			later = new Date('2026-11-12T12:01:00Z')
		await Promise.all([
			position(firstDb, owner, 0.8, 80, earlier),
			position(secondDb, owner, 0.2, 20, later)
		])
		await Promise.all([first.close({ timeoutMs: 0 }), second.close({ timeoutMs: 0 })])
		first = undefined
		second = undefined
		await authority.stop()
		authority = undefined
		first = await createJazzClient(config('first'))
		second = await createJazzClient(config('second'))
		const reopenedFirst = first.getSnapshot().client?.db,
			reopenedSecond = second.getSnapshot().client?.db
		if (!reopenedFirst || !reopenedSecond) throw new Error('Missing restarted replicas')
		await Promise.all([reopenedFirst.disconnect(), reopenedSecond.disconnect()])
		expect(await reopenedFirst.one(query, { tier: ReadTier.LocalFirst })).toMatchObject({
			readingProgress: 0.8,
			resumePosition: { offset: 80, interactedAt: earlier }
		})
		expect(await reopenedSecond.one(query, { tier: ReadTier.LocalFirst })).toMatchObject({
			readingProgress: 0.2,
			resumePosition: { offset: 20, interactedAt: later }
		})
		authority = await startAuthority(directory, port)
		for (const db of [reopenedFirst, reopenedSecond])
			releases.push(
				db.subscribe(
					query,
					{ onUpdate: () => {}, onError: () => {} },
					{ tier: ReadTier.LocalFirst }
				)
			)
		await Promise.all([reopenedFirst.reconnect(), reopenedSecond.reconnect()])
		for (const db of [reopenedFirst, reopenedSecond])
			await expect
				.poll(() => db.one(query, { tier: ReadTier.LocalFirst }), { timeout: 10_000 })
				.toMatchObject({
					readingProgress: 0.8,
					resumePosition: { offset: 20, interactedAt: later }
				})
	} finally {
		for (const release of releases) release()
		await Promise.all([first?.close({ timeoutMs: 0 }), second?.close({ timeoutMs: 0 })])
		await authority?.stop()
		await rm(directory, { recursive: true, force: true })
	}
}, 30_000)
