import { afterAll, beforeAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './jazz.generated.js'
import permissions from './jazz.permissions.json' with { type: 'json' }
import { createLibraryRecords } from './records.js'
import { documentsQuery } from './queries.js'
import { documentRecord, captureDocumentRecord } from './document-record.js'
import { newDocumentValues } from './document-values.js'
import type { LibraryArticle, CaptureDocument } from '../../contracts/articles.js'
import { articleId } from '../../capture/source.js'
let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterAll(async () => {
	await fixture?.shutdown()
})
async function owner(name: string) {
	const session = {
		user_id: name,
		authMode: 'device-account',
		claims: {}
	} satisfies PolicyTestSession
	const db = fixture.as(session),
		id = fixture.accountFor(session)
	await db
		.upsert(app.libraries, id, { ownerId: id, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	return { db, id, records: createLibraryRecords(db, id, () => true) }
}
const content = {
	title: 'Captured article',
	text: 'Readable content',
	html: '<p>Readable content</p>',
	finalUrl: 'https://example.com/redirected',
	siteName: 'Example',
	provenance: '{}'
}
it('keeps native list and queue observers alive while capture metadata arrives after its document', async () => {
	const account = await owner('late-capture-metadata')
	const url = 'https://example.com/arriving'
	const id = await articleId(account.id, url)
	await account.db
		.insert(app.libraryDocuments, newDocumentValues(id, account.id, url), { id })
		.wait({ tier: 'global' })
	let observed: LibraryArticle[] | undefined
	let pending: CaptureDocument[] | undefined
	let failed = false
	const release = account.records.articles.subscribe(
		(rows) => {
			observed = rows
		},
		() => {
			failed = true
		}
	)
	const releasePending = account.records.articles.subscribePending(
		(rows) => {
			pending = rows
		},
		() => {
			failed = true
		}
	)
	try {
		await expect.poll(() => ({ observed, pending })).toEqual({ observed: [], pending: [] })
		expect(failed).toBe(false)
		await account.db
			.insert(
				app.documentCaptures,
				{ libraryId: account.id, documentId: id, operationId: null, failure: null },
				{ id }
			)
			.wait({ tier: 'global' })
		await expect.poll(() => observed?.map((row) => row.id)).toEqual([id])
		await expect.poll(() => pending?.map((row) => row.id)).toEqual([id])
		expect(observed?.[0]).toMatchObject({ url, readable: false, status: 'inbox' })
		const saved = await toPromise(
			createActor(account.records.articles.saveMachine, { input: { url, content } }).start()
		)
		expect(saved.kind).toBe('saved')
		if (saved.kind !== 'saved') throw new Error('Expected native content completion')
		await Promise.all(saved.receipts.map((receipt) => receipt.global()))
		await expect.poll(() => pending).toEqual([])
		await expect.poll(() => observed?.[0]?.readable).toBe(true)
		expect(failed).toBe(false)
	} finally {
		releasePending()
		release()
	}
})
it('still refuses a capture whose identity does not match its document', async () => {
	const account = await owner('mislinked-capture-metadata')
	const id = crypto.randomUUID()
	await account.db
		.insert(app.libraryDocuments, newDocumentValues(id, account.id, null), { id })
		.wait({ tier: 'global' })
	await account.db
		.insert(
			app.documentCaptures,
			{ libraryId: account.id, documentId: id, operationId: null, failure: null },
			{ id: crypto.randomUUID() }
		)
		.wait({ tier: 'global' })
	let failed = false
	const release = account.records.articles.subscribe(
		() => {},
		() => {
			failed = true
		}
	)
	try {
		await expect.poll(() => failed).toBe(true)
	} finally {
		release()
	}
})
it('creates progress zero on URL-only saves and preserves Document state while attaching Article content', async () => {
	const account = await owner('joined-document')
	const url = 'https://short.example/story?q=1#passage'
	const first = await toPromise(
		createActor(account.records.articles.saveMachine, { input: { url } }).start()
	)
	expect(first.kind).toBe('saved')
	if (first.kind === 'saved') await Promise.all(first.receipts.map((receipt) => receipt.global()))
	const before = await account.db.one(documentsQuery.where({ id: first.operationId }))
	expect(before).toMatchObject({
		sourceUrl: url,
		readingProgress: 0,
		resumePosition: [],
		attachment: null
	})
	await account.db
		.update(app.libraryDocuments, first.operationId, { readingProgress: 0.7 })
		.wait({ tier: 'global' })
	const saved = await toPromise(
		createActor(account.records.articles.saveMachine, { input: { url, content } }).start()
	)
	expect(saved.kind).toBe('saved')
	if (saved.kind !== 'saved') throw new Error('Expected save')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	const after = await account.db.one(documentsQuery.where({ id: first.operationId }))
	expect(before?.$createdAt).toBeInstanceOf(Date)
	expect(captureDocumentRecord(after, account.id).createdAt).toEqual(after?.$createdAt)
	expect(await account.db.all(app.libraryDocuments.where({ id: first.operationId }))).toHaveLength(
		1
	)
	const document = documentRecord(after, account.id)
	expect(document).toMatchObject({
		id: first.operationId,
		sourceUrl: url,
		readingProgress: 0.7,
		attachment: {
			title: content.title,
			html: content.html,
			text: content.text,
			source: { resolvedUrl: content.finalUrl, canonicalUrl: null },
			site: { origin: 'https://example.com', name: 'Example', favicon: null }
		}
	})
	expect(document).not.toHaveProperty('title')
	expect(document).not.toHaveProperty('attachmentId')
})
it('initializes direct content saves and reuses a Site by resolved origin', async () => {
	const account = await owner('shared-site')
	for (const suffix of ['one', 'two']) {
		const result = await toPromise(
			createActor(account.records.articles.saveMachine, {
				input: {
					url: `https://example.com/${suffix}`,
					content: { ...content, finalUrl: `https://example.com/${suffix}` }
				}
			}).start()
		)
		expect(result.kind).toBe('saved')
		const row = await account.db.one(documentsQuery.where({ id: result.operationId }))
		expect(row).toMatchObject({ readingProgress: 0, sourceUrl: `https://example.com/${suffix}` })
	}
	expect(await account.db.all(app.sites.where({ libraryId: account.id }))).toHaveLength(1)
})
it('retains furthest progress when an older/lower measurement is written later', async () => {
	const account = await owner('monotonic-progress')
	const id = crypto.randomUUID()
	const furthest = 0.24307803762649702
	await account.db
		.insert(app.libraryDocuments, newDocumentValues(id, account.id, null), { id })
		.wait({ tier: 'global' })
	await account.db
		.update(app.libraryDocuments, id, { readingProgress: furthest })
		.wait({ tier: 'global' })
	await account.db
		.update(app.libraryDocuments, id, { readingProgress: 0.2 })
		.wait({ tier: 'global' })
	expect(await account.db.one(app.libraryDocuments.where({ id }))).toMatchObject({
		readingProgress: furthest
	})
})
it('denies cross-library Article and Site relationships', async () => {
	const account = await owner('relationship-owner')
	const other = await owner('relationship-outsider')
	const result = await toPromise(
		createActor(account.records.articles.saveMachine, {
			input: { url: 'https://example.com/private', content }
		}).start()
	)
	const document = await account.db.one(documentsQuery.where({ id: result.operationId }))
	const attachment = document?.attachment
	if (!attachment) throw new Error('Expected attachment')
	const id = crypto.randomUUID()
	await expect(
		other.db
			.insert(
				app.libraryDocuments,
				{ ...newDocumentValues(id, other.id, null), attachmentId: attachment.id },
				{ id }
			)
			.wait({ tier: 'global' })
	).rejects.toThrow()
	const operationId = crypto.randomUUID()
	await other.db
		.insert(
			app.storageOperations,
			{ libraryId: other.id, payloadHash: 'test' },
			{ id: operationId }
		)
		.wait({ tier: 'global' })
	await expect(
		other.db
			.insert(
				app.articles,
				{
					libraryId: other.id,
					operationId,
					title: 'Wrong site',
					author: null,
					publishedAt: null,
					language: null,
					siteId: attachment.siteId,
					source: null,
					html: '',
					text: 'Wrong scope'
				},
				{ id: crypto.randomUUID() }
			)
			.wait({ tier: 'global' })
	).rejects.toThrow()
})
