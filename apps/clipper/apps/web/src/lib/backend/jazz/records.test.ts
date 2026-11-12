import type { SaveRequest } from '../../contracts/storage.js'
import { policySchema } from './schema-permissions.test-support.js'
import { readRecord } from '../../machines/storage/read.test-support.js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import { storageSyncMachine } from '../../machines/storage/sync.js'
import { BYTE_LIMIT, prepareSave } from '../../storage/prepare.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => {
	await fixture?.shutdown()
})
async function owner(name: string) {
	const session = {
		user_id: name,
		authMode: 'local-first',
		claims: {}
	} satisfies import('jazz-tools/testing').PolicyTestSession
	const db = fixture.as(session),
		id = fixture.accountFor(session)
	await db
		.upsert(app.libraries, id, { ownerId: id, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	return { db, id, store: createLibraryRecords(db, id, () => true) }
}
function request() {
	return {
		operationId: crypto.randomUUID(),
		title: 'Stored Article',
		text: 'Unicode café 🦊',
		bytes: new TextEncoder().encode('<p>Unicode café 🦊</p>'),
		mediaType: 'text/html'
	} satisfies SaveRequest
}
it('publishes Article content, a joined Document and required zero progress after local persistence', async () => {
	const { db, id, store } = await owner('records-owner'),
		input = request()
	const saved = await toPromise(createActor(store.saveMachine, { input }).start())
	if (saved.kind !== 'saved') throw new Error('Expected local save')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	expect(await db.one(app.libraryDocuments.where({ id: input.operationId }))).toMatchObject({
		readingProgress: 0,
		attachmentId: input.operationId
	})
	expect(await db.one(app.articles.where({ id: input.operationId }))).toMatchObject({
		html: '<p>Unicode café 🦊</p>',
		text: input.text
	})
	expect(await readRecord(store.readCapabilities, input.operationId)).toMatchObject({
		kind: 'available',
		text: input.text,
		document: { library: { id } },
		attachment: { title: input.title }
	})
	expect((await toPromise(createActor(store.saveMachine, { input }).start())).kind).toBe('blocked')
})
it('denies foreign reads and immutable Article updates', async () => {
	const a = await owner('records-a'),
		b = await owner('records-b'),
		input = request()
	const saved = await toPromise(createActor(a.store.saveMachine, { input }).start())
	if (saved.kind !== 'saved') throw new Error('Expected save')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	expect(await b.db.one(app.articles.where({ id: input.operationId }))).toBeNull()
	expect(await b.db.one(app.libraryDocuments.where({ id: input.operationId }))).toBeNull()
	expect(await b.db.one(app.storageOperations.where({ id: input.operationId }))).toBeNull()
	await expect(
		a.db.update(app.articles, input.operationId, { title: 'Overwrite' }).wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
	await expect(
		a.db.delete(app.articles, input.operationId).wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
})
it('keeps staging intent separate from readable content and refuses replay', async () => {
	const { db, id, store } = await owner('records-staging'),
		input = request(),
		draft = await prepareSave(id, input)
	const { id: operationId, ...intent } = draft.intent
	await db.insert(app.storageOperations, intent, { id: operationId }).wait({ tier: 'global' })
	expect((await readRecord(store.readCapabilities, operationId)).kind).toBe('missing')
	expect((await toPromise(createActor(store.saveMachine, { input }).start())).kind).toBe('blocked')
})
it('rejects oversized content before writing its operation intent', async () => {
	const { db, store } = await owner('records-limit'),
		input = { ...request(), bytes: new Uint8Array(BYTE_LIMIT + 1) }
	expect((await toPromise(createActor(store.saveMachine, { input }).start())).kind).toBe('failed')
	expect(await db.one(app.storageOperations.where({ id: input.operationId }))).toBeNull()
})
it('reports authority rejection through sync while preserving immutable saved content', async () => {
	const { db, store } = await owner('records-rejection'),
		input = request()
	const saved = await toPromise(createActor(store.saveMachine, { input }).start())
	if (saved.kind !== 'saved') throw new Error('Expected save')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	const write = db.update(app.articles, input.operationId, { title: 'Forbidden replacement' })
	const actor = createActor(storageSyncMachine, {
		input: [{ global: () => write.wait({ tier: 'global' }) }]
	}).start()
	await toPromise(actor)
	expect(actor.getSnapshot().value).toBe('rejected')
	expect((await db.one(app.articles.where({ id: input.operationId })))?.title).toBe(input.title)
})
it('rejects cross-library publication atomically', async () => {
	const a = await owner('atomic-a'),
		b = await owner('atomic-b'),
		id = crypto.randomUUID(),
		tx = a.db.beginTransaction()
	tx.insert(app.storageOperations, { libraryId: a.id, payloadHash: 'atomic' }, { id })
	tx.insert(
		app.articles,
		{
			libraryId: b.id,
			operationId: id,
			title: 'Forbidden',
			author: null,
			publishedAt: null,
			language: null,
			siteId: null,
			source: null,
			html: '',
			text: 'Private'
		},
		{ id }
	)
	await expect(tx.commit().wait({ tier: 'global' })).rejects.toThrow(/denied|rejected/i)
	expect(await a.db.one(app.storageOperations.where({ id }))).toBeNull()
	expect(await b.db.one(app.articles.where({ id }))).toBeNull()
})
it('propagates a failed joined search read without issuing independent content lookups', async () => {
	const { db, store } = await owner('failed-search'),
		read = vi.spyOn(db, 'all').mockRejectedValueOnce(new Error('Read failed'))
	await expect(store.searchDocuments([], new AbortController().signal)).rejects.toThrow(
		'Read failed'
	)
	expect(read).toHaveBeenCalledOnce()
	read.mockRestore()
})
