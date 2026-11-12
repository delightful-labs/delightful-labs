import { policySchema } from './schema-permissions.test-support.js'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import { articleId } from '../../capture/source.js'
import { readRecord } from '../../machines/storage/read.test-support.js'
let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => {
	await fixture?.shutdown()
})
async function owner(name: string) {
	const session = { user_id: name, authMode: 'local-first', claims: {} } satisfies PolicyTestSession
	const db = fixture.as(session),
		id = fixture.accountFor(session)
	await db
		.upsert(app.libraries, id, { ownerId: id, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	return { db, id, records: createLibraryRecords(db, id, () => true) }
}
const url = 'https://short.example/article?b=2&a=1#note'
const content = {
	title: 'Saved article',
	excerpt: 'Parser description café 🦊. '.repeat(200),
	author: 'Ada Example',
	siteName: 'Example Journal',
	publishedTime: '2026-10-02T12:30:00+02:00',
	lang: 'ar',
	dir: 'rtl',
	featuredImageUrl: 'https://example.com/cover.png',
	text: 'Exact text café 🦊',
	html: '<p>Exact text café 🦊</p>',
	finalUrl: 'https://example.com/article',
	provenance: '{}'
}
it('persists a URL-only Document with zero progress and no Article', async () => {
	const a = await owner('url-only'),
		result = await toPromise(
			createActor(a.records.articles.saveMachine, { input: { url } }).start()
		)
	expect(result.kind).toBe('saved')
	expect(await a.records.articles.read(result.operationId)).toMatchObject({
		sourceUrl: url,
		readingProgress: 0,
		attachment: null,
		operationId: null,
		failure: null
	})
	expect(await a.db.all(app.articles.where({ libraryId: a.id }))).toEqual([])
	expect(await a.db.all(app.storageOperations.where({ libraryId: a.id }))).toEqual([])
})
it('attaches content to the saved Document while preserving its identity and native state', async () => {
	const a = await owner('attachment'),
		first = await toPromise(createActor(a.records.articles.saveMachine, { input: { url } }).start())
	if (first.kind === 'saved') await Promise.all(first.receipts.map((receipt) => receipt.global()))
	const before = await a.records.articles.read(first.operationId)
	const saved = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url, content } }).start()
	)
	expect(saved).toMatchObject({ kind: 'saved', ready: true, operationId: first.operationId })
	const after = await a.records.articles.read(first.operationId)
	expect(after?.id).toBe(before?.id)
	expect(after?.createdAt).toBeInstanceOf(Date)
	expect(after?.attachment).toMatchObject({
		title: content.title,
		author: content.author,
		publishedAt: content.publishedTime,
		language: content.lang,
		html: content.html,
		text: content.text,
		site: { name: content.siteName }
	})
	expect(await readRecord(a.records.readCapabilities, saved.operationId)).toMatchObject({
		kind: 'available',
		text: content.text,
		source: { resolvedUrl: content.finalUrl }
	})
	const repeat = await toPromise(
		createActor(a.records.articles.saveMachine, {
			input: { url, content: { ...content, text: 'Replacement' } }
		}).start()
	)
	expect(repeat.kind).toBe('duplicate')
	expect((await a.records.articles.read(first.operationId))?.attachment?.text).toBe(content.text)
})
it('lets independent Documents reuse an existing Article through a native relationship', async () => {
	const a = await owner('shared-attachment')
	const first = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url, content } }).start()
	)
	expect(first.kind).toBe('saved')
	const second = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url: content.finalUrl } }).start()
	)
	expect(second).toMatchObject({ ready: true })
	expect(second.operationId).not.toBe(first.operationId)
	expect((await a.records.articles.read(second.operationId))?.attachment?.id).toBe(
		(await a.records.articles.read(first.operationId))?.attachment?.id
	)
	expect(await a.db.all(app.libraryDocuments.where({ libraryId: a.id }))).toHaveLength(2)
	expect(await a.db.all(app.articles.where({ libraryId: a.id }))).toHaveLength(1)
})
it('keeps a pending Document and refuses blind replay of a stranded storage intent', async () => {
	const a = await owner('stranded'),
		first = await toPromise(createActor(a.records.articles.saveMachine, { input: { url } }).start())
	const target = await articleId(a.id, content.finalUrl)
	await a.db
		.insert(app.storageOperations, { libraryId: a.id, payloadHash: 'stranded' }, { id: target })
		.wait({ tier: 'global' })
	const saved = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url, content } }).start()
	)
	expect(saved.kind).toBe('unknown')
	expect(await a.records.articles.read(first.operationId)).toMatchObject({
		sourceUrl: url,
		attachment: null
	})
	expect(await a.db.all(app.articles.where({ libraryId: a.id }))).toEqual([])
})
it('does not disclose foreign Documents and refuses cross-library Article relationships', async () => {
	const a = await owner('private-owner'),
		b = await owner('private-foreign')
	const saved = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url, content } }).start()
	)
	const document = await a.records.articles.read(saved.operationId)
	if (!document?.attachment) throw new Error('Missing saved attachment')
	expect(await b.records.articles.read(saved.operationId)).toBeNull()
	await expect(
		b.db
			.insert(app.libraryDocuments, {
				libraryId: b.id,
				sourceUrl: url,
				readingProgress: 0,
				resumePosition: null,
				status: 'inbox',
				favorite: false,
				attachmentId: document.attachment.id
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
})
