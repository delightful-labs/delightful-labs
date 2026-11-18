import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJazz, createJazzClient, acceptLocalFirstAuth, sqlite } from 'jazz-tools/backend'
import type { BackendClientSession, JazzClientConfig } from 'jazz-tools/backend'
import { ReadTier } from 'jazz-tools'
import { app } from './schema.js'
import permissions from './permissions.js'
import { app as baseline } from './production-baseline-schema.test-support.js'
import baselinePermissions from './production-baseline-permissions.test-support.js'
import { migrations } from './migrations/index.js'
import { newDocumentValues } from './document-values.js'

async function startAuthority(directory: string, version: 'baseline' | 'current', port = 0) {
	const server = createServer((request, response) => backend.nodeHandler(request, response))
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, '127.0.0.1', resolve)
	})
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('Missing disposable authority port')
	const origin = `http://127.0.0.1:${address.port}`
	const backend = createJazz({
		app: version === 'baseline' ? baseline : app,
		permissions: version === 'baseline' ? baselinePermissions : permissions,
		store: sqlite({ path: join(directory, 'authority') }),
		authenticate: acceptLocalFirstAuth,
		publicUrl: [`${origin}/jazz`],
		allowedOrigins: [origin]
	})
	try {
		await backend.attach(server)
		await backend.ready()
	} catch (error) {
		await backend.close()
		server.closeAllConnections()
		await new Promise<void>((resolve) => server.close(() => resolve()))
		throw error
	}
	return {
		backend,
		port: address.port,
		url: `${origin}/jazz`,
		stop: async () => {
			await backend.close()
			server.closeAllConnections()
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			)
		}
	}
}

it('upgrades the production SQLite store and a populated replica without changing identity or losing records', async () => {
	const historical = migrations.schemas.find((schema) => schema.hash.startsWith('8a5130d42577'))
	expect(historical?.schema).toEqual({ tables: baseline.wasmSchema })
	const directory = await mkdtemp(join(tmpdir(), 'clipper-production-migration-'))
	let authority: Awaited<ReturnType<typeof startAuthority>> | undefined
	let client: BackendClientSession | undefined
	let identity: string | null = null
	try {
		authority = await startAuthority(directory, 'baseline')
		const { url, port } = authority,
			appId = authority.backend.appId
		const config = (version: 'baseline' | 'current'): JazzClientConfig => ({
			app: version === 'baseline' ? baseline : app,
			permissions: version === 'baseline' ? baselinePermissions : permissions,
			appId,
			serverUrl: url,
			driver: { type: 'persistent', dataPath: join(directory, 'replica') },
			initial: 'local-first',
			env: 'test',
			store: {
				read: async () => identity,
				update: async (transform) => {
					identity = transform(identity)
				}
			}
		})
		client = await createJazzClient(config('baseline'))
		const owner = client.getSnapshot().account?.id,
			db = client.getSnapshot().client?.db
		if (!owner || !db) throw new Error('Missing baseline replica')
		await db
			.insert(baseline.libraries, { ownerId: owner, bootstrapVersion: '1' }, { id: owner })
			.wait({ tier: 'global' })
		const documentId = crypto.randomUUID(),
			articleId = crypto.randomUUID(),
			assetId = crypto.randomUUID(),
			noteId = crypto.randomUUID(),
			revisionId = crypto.randomUUID(),
			userId = crypto.randomUUID(),
			atprotoId = crypto.randomUUID(),
			date = new Date('2026-11-12T12:00:00Z')
		const signedInAccount = await authority.backend.createAccountFor(userId)
		await db
			.insert(
				baseline.libraryDocuments,
				{
					...newDocumentValues(documentId, owner, 'https://example.org/saved'),
					readingProgress: 0.4,
					favorite: true
				},
				{ id: documentId }
			)
			.wait({ tier: 'global' })
		await authority.backend.db
			.insert(
				baseline.storageOperations,
				{
					libraryId: owner,
					payloadHash: 'existing-operation'
				},
				{ id: documentId }
			)
			.wait({ tier: 'global' })
		await authority.backend.db
			.insert(
				baseline.articles,
				{
					libraryId: owner,
					operationId: documentId,
					title: 'Saved article',
					html: '<p>Existing article text</p>',
					text: 'Existing article text'
				},
				{ id: articleId }
			)
			.wait({ tier: 'global' })
		await authority.backend.db
			.insert(
				baseline.assets,
				{
					libraryId: owner,
					operationId: documentId,
					mediaType: 'image/png',
					payload: new Uint8Array([1, 2, 3])
				},
				{ id: assetId }
			)
			.wait({ tier: 'global' })
		await authority.backend.db
			.update(baseline.libraryDocuments, documentId, { attachmentId: articleId })
			.wait({ tier: 'global' })
		expect(
			await db.one(baseline.libraryDocuments.where({ id: documentId }), { tier: ReadTier.Remote })
		).toMatchObject({ attachmentId: articleId })
		await db.one(baseline.articles.where({ id: articleId }), { tier: ReadTier.Remote })
		await db.one(baseline.assets.where({ id: assetId }), { tier: ReadTier.Remote })
		await db
			.insert(baseline.notes, { libraryId: owner, documentId }, { id: noteId })
			.wait({ tier: 'global' })
		await db
			.insert(
				baseline.noteRevisions,
				{
					libraryId: owner,
					noteId,
					text: 'Existing private note',
					parents: '[]',
					editedAt: date.toISOString()
				},
				{ id: revisionId }
			)
			.wait({ tier: 'global' })
		await authority.backend.db
			.insert(
				baseline.better_auth_user,
				{
					name: 'Migration fixture',
					email: 'migration@example.invalid',
					emailVerified: true,
					createdAt: date,
					updatedAt: date
				},
				{ id: userId }
			)
			.wait({ tier: 'global' })
		await authority.backend.db
			.insert(
				baseline.better_auth_atprotoSession,
				{
					did: 'did:plc:migration-fixture',
					sessionData: 'synthetic-session',
					userId,
					handle: 'migration.invalid',
					pdsUrl: 'https://pds.invalid',
					updatedAt: date
				},
				{ id: atprotoId }
			)
			.wait({ tier: 'global' })
		await client.close()
		client = undefined
		await authority.stop()
		authority = undefined

		authority = await startAuthority(directory, 'current', port)
		expect(authority.backend.appId).toBe(appId)
		expect(await authority.backend.createAccountFor(userId)).toBe(signedInAccount)
		client = await createJazzClient(config('current'))
		expect(client.getSnapshot().account?.id).toBe(owner)
		const upgraded = client.getSnapshot().client?.db
		if (!upgraded) throw new Error('Missing upgraded replica')
		await upgraded.disconnect()
		expect(
			await upgraded.one(app.libraryDocuments.where({ id: documentId }), {
				tier: ReadTier.LocalFirst
			})
		).toMatchObject({
			readingProgress: 0.4,
			favorite: true,
			sourceUrl: 'https://example.org/saved',
			attachmentId: articleId
		})
		expect(
			await upgraded.one(app.articles.where({ id: articleId }), { tier: ReadTier.LocalFirst })
		).toMatchObject({ title: 'Saved article', text: 'Existing article text' })
		expect(
			(await upgraded.one(app.assets.where({ id: assetId }), { tier: ReadTier.LocalFirst }))
				?.payload
		).toEqual(new Uint8Array([1, 2, 3]))
		expect(
			await upgraded.one(app.notes.where({ id: noteId }), { tier: ReadTier.LocalFirst })
		).toMatchObject({ documentId, libraryId: owner, highlightId: null, source: null, text: '' })
		expect(
			await upgraded.one(app.noteRevisions.where({ id: revisionId }), { tier: ReadTier.LocalFirst })
		).toMatchObject({ noteId, text: 'Existing private note' })
		expect(
			await authority.backend.db.one(app.better_auth_atprotoSession.where({ id: atprotoId }))
		).toMatchObject({ userId, sessionData: 'synthetic-session' })
		await client.close({ timeoutMs: 0 })
		client = undefined
		await authority.stop()
		authority = undefined

		authority = await startAuthority(directory, 'current', port)
		const highlightId = crypto.randomUUID(),
			attachedId = crypto.randomUUID()
		await authority.backend.db
			.insert(
				app.highlights,
				{
					libraryId: owner,
					documentId,
					source: 'https://example.org/saved'
				},
				{ id: highlightId }
			)
			.wait({ tier: 'global' })
		await authority.backend.db
			.insert(
				app.notes,
				{
					libraryId: owner,
					documentId,
					highlightId,
					text: 'New attached note'
				},
				{ id: attachedId }
			)
			.wait({ tier: 'global' })
		expect(
			await authority.backend.db.one(
				app.notes.where({ id: attachedId }).include({ highlight: true })
			)
		).toMatchObject({
			documentId,
			text: 'New attached note',
			highlight: { id: highlightId, documentId }
		})
		expect(
			await authority.backend.db.one(app.noteRevisions.where({ id: revisionId }))
		).toMatchObject({ text: 'Existing private note' })
	} finally {
		await client?.close({ timeoutMs: 0 })
		await authority?.stop()
		await rm(directory, { recursive: true, force: true })
	}
}, 30_000)
