import { afterAll, beforeAll, expect, it } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import type { Db } from 'jazz-tools'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'
import { policySchema } from '../../backend/jazz/schema-permissions.test-support.js'
import { newDocumentValues } from '../../backend/jazz/document-values.js'
import { createDocumentNotePreview } from './preview.js'
import type { PublicationSource } from '../../annotations/publication-link.js'

let fixture: PolicyTestApp
const publishingDid = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
const createdAt = new Date('2026-11-16T15:00:00Z')
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => fixture?.shutdown())

async function owner(name: string) {
	const session = { user_id: name, authMode: 'local-first', claims: {} } satisfies PolicyTestSession
	const libraryId = fixture.accountFor(session)
	const backend = await fixture.seed<Db>((server) => {
		const write = server.upsert(app.libraries, libraryId, {
			ownerId: libraryId,
			bootstrapVersion: '1'
		})
		return {
			value: server,
			wait: async (options) => {
				await write.wait(options)
				return server
			}
		}
	})
	const documentId = crypto.randomUUID(),
		noteId = crypto.randomUUID()
	await backend
		.insert(
			app.libraryDocuments,
			newDocumentValues(documentId, libraryId, 'https://example.org/article'),
			{ id: documentId }
		)
		.wait({ tier: 'global' })
	await backend
		.insert(
			app.notes,
			{
				libraryId,
				documentId,
				highlightId: null,
				source: 'https://example.org/article',
				text: 'My private note 🦊'
			},
			{ id: noteId }
		)
		.wait({ tier: 'global' })
	return {
		backend,
		libraryId,
		documentId,
		noteId,
		scope: { libraryId, accountId: libraryId, publishingDid, isCurrent: () => true }
	}
}

function preview(
	a: Awaited<ReturnType<typeof owner>>,
	source: PublicationSource = { noteId: a.noteId }
) {
	return toPromise(
		createActor(createDocumentNotePreview(a.backend, a.scope), {
			input: { source, createdAt }
		}).start()
	)
}

function deferred() {
	let release = () => {}
	const promise = new Promise<void>((resolve) => {
		release = resolve
	})
	return { promise, release: () => release() }
}

function holdRead(db: Pick<Db, 'one'>) {
	const entered = deferred(),
		gate = deferred()
	const one: Db['one'] = async (query, options) => {
		const row = await db.one(query, options)
		entered.release()
		await gate.promise
		return row
	}
	return { one, entered: entered.promise, release: gate.release }
}

it('previews accepted document-note content without changing the note or allocating a link', async () => {
	const a = await owner('preview-owned')
	expect(await preview(a)).toEqual({
		libraryId: a.libraryId,
		source: { noteId: a.noteId },
		publishingDid,
		record: {
			$type: 'at.margin.note',
			motivation: 'commenting',
			target: { source: 'https://example.org/article' },
			body: { value: 'My private note 🦊', format: 'text/plain' },
			createdAt: '2026-11-16T15:00:00.000Z'
		}
	})
	expect(await a.backend.all(app.publicationLinks.where({ libraryId: a.libraryId }))).toEqual([])
	expect((await a.backend.one(app.notes.where({ id: a.noteId })))?.text).toBe('My private note 🦊')
	await a.backend.update(app.notes, a.noteId, { text: '' }).wait({ tier: 'global' })
	expect((await preview(a))?.record).toMatchObject({ body: { value: '' } })
})

it('does not expose foreign roots, wrong-owner content, missing notes or deleted notes', async () => {
	const a = await owner('preview-private'),
		b = await owner('preview-other')
	expect(await preview(a, { noteId: b.noteId })).toBeUndefined()
	expect(await preview({ ...a, scope: { ...a.scope, accountId: b.libraryId } })).toBeUndefined()
	expect(await preview(a, { noteId: crypto.randomUUID() })).toBeUndefined()
	await a.backend.delete(app.notes, a.noteId).wait({ tier: 'global' })
	expect(await preview(a)).toBeUndefined()
})

it('refuses highlights before reading and does not treat an attached note as an independent root', async () => {
	const a = await owner('preview-attached'),
		highlightId = crypto.randomUUID()
	await a.backend
		.insert(
			app.highlights,
			{
				libraryId: a.libraryId,
				documentId: a.documentId,
				source: 'https://example.org/article'
			},
			{ id: highlightId }
		)
		.wait({ tier: 'global' })
	await a.backend
		.update(app.notes, a.noteId, {
			documentId: null,
			highlightId,
			source: null
		})
		.wait({ tier: 'global' })
	expect(await preview(a)).toBeUndefined()
	let reads = 0
	const one: Db['one'] = (query, options) => {
		reads++
		return a.backend.one(query, options)
	}
	expect(
		await toPromise(
			createActor(createDocumentNotePreview({ one }, a.scope), {
				input: { source: { highlightId }, createdAt }
			}).start()
		)
	).toBeUndefined()
	expect(reads).toBe(0)
})

it('refuses trashed, missing or cross-library documents', async () => {
	const a = await owner('preview-parent'),
		b = await owner('preview-foreign-parent')
	await a.backend.update(app.notes, a.noteId, { documentId: b.documentId }).wait({ tier: 'global' })
	expect(await preview(a)).toBeUndefined()
	await a.backend.update(app.notes, a.noteId, { documentId: a.documentId }).wait({ tier: 'global' })
	await a.backend
		.update(app.libraryDocuments, a.documentId, {
			status: 'trashed',
			previousStatus: 'inbox'
		})
		.wait({ tier: 'global' })
	expect(await preview(a)).toBeUndefined()
	await a.backend.delete(app.libraryDocuments, a.documentId).wait({ tier: 'global' })
	expect(await preview(a)).toBeUndefined()
})

it('leaves an existing same-publisher association to the future reconciliation workflow', async () => {
	const a = await owner('preview-linked')
	await a.backend
		.insert(app.publicationLinks, {
			libraryId: a.libraryId,
			highlightId: null,
			noteId: a.noteId,
			uri: 'at://did:web:another.example/at.margin.note/other-publisher'
		})
		.wait({ tier: 'global' })
	expect(await preview(a)).toBeDefined()
	await a.backend
		.insert(app.publicationLinks, {
			libraryId: a.libraryId,
			highlightId: null,
			noteId: a.noteId,
			uri: `at://${publishingDid}/at.margin.note/existing`
		})
		.wait({ tier: 'global' })
	expect(await preview(a)).toBeUndefined()
})

it('refuses invalid source URLs and oversized merged text without truncation or private errors', async () => {
	const a = await owner('preview-limits')
	await a.backend
		.update(app.notes, a.noteId, { source: 'https://user:secret@example.org' })
		.wait({ tier: 'global' })
	expect(await preview(a)).toBeUndefined()
	const text = 'x'.repeat(3001)
	await a.backend
		.update(app.notes, a.noteId, { source: 'https://example.org/article', text })
		.wait({ tier: 'global' })
	expect(await preview(a)).toBeUndefined()
	expect((await a.backend.one(app.notes.where({ id: a.noteId })))?.text).toBe(text)
})

it('rejects expired scopes and malformed destinations before reading, and contains native read errors', async () => {
	const a = await owner('preview-admission')
	let reads = 0
	const one: Db['one'] = () => {
		reads++
		throw new Error('Private native details')
	}
	for (const scope of [
		{ ...a.scope, isCurrent: () => false },
		{ ...a.scope, publishingDid: 'not-a-did' },
		{ ...a.scope, libraryId: 'not-a-uuid' }
	]) {
		expect(
			await toPromise(
				createActor(createDocumentNotePreview({ one }, scope), {
					input: { source: { noteId: a.noteId }, createdAt }
				}).start()
			)
		).toBeUndefined()
	}
	expect(reads).toBe(0)
	for (const input of [
		{ source: { noteId: a.noteId }, createdAt: new Date(NaN) },
		{ source: { noteId: 'not-a-uuid' }, createdAt },
		{ source: { noteId: a.noteId, highlightId: crypto.randomUUID() }, createdAt }
	]) {
		expect(
			await toPromise(
				createActor(createDocumentNotePreview({ one }, a.scope), {
					input
				}).start()
			)
		).toBeUndefined()
	}
	expect(reads).toBe(0)
	expect(
		await toPromise(
			createActor(createDocumentNotePreview({ one }, a.scope), {
				input: { source: { noteId: a.noteId }, createdAt }
			}).start()
		)
	).toBeUndefined()
	expect(reads).toBe(1)
})

it('bounds a stalled read and ignores late completion after timeout or host stop', async () => {
	const a = await owner('preview-read-lifetime')
	for (const stop of [false, true]) {
		const held = holdRead(a.backend),
			clock = new SimulatedClock()
		const actor = createActor(createDocumentNotePreview(held, a.scope), {
			input: { source: { noteId: a.noteId }, createdAt },
			clock
		}).start()
		try {
			await held.entered
			if (stop) actor.stop()
			else {
				clock.increment(30_000)
				expect(await toPromise(actor)).toBeUndefined()
			}
			held.release()
			await Promise.resolve()
			await Promise.resolve()
			expect(actor.getSnapshot().status).toBe(stop ? 'stopped' : 'done')
			expect(actor.getSnapshot().output).toBeUndefined()
		} finally {
			held.release()
			actor.stop()
		}
	}
})

it('discards an in-flight result after scope invalidation or cancellation', async () => {
	const a = await owner('preview-late')
	for (const cancel of [false, true]) {
		const held = holdRead(a.backend)
		let current = true
		const actor = createActor(
			createDocumentNotePreview(held, {
				...a.scope,
				isCurrent: () => current
			}),
			{ input: { source: { noteId: a.noteId }, createdAt } }
		).start()
		const result = toPromise(actor)
		try {
			await held.entered
			if (cancel) actor.send({ type: 'CANCEL' })
			else current = false
			held.release()
			expect(await result).toBeUndefined()
			expect(actor.getSnapshot().matches('unavailable')).toBe(true)
		} finally {
			held.release()
			actor.stop()
		}
	}
})

it('copies the selected source, destination binding and candidate time before awaiting a native read', async () => {
	const a = await owner('preview-snapshot'),
		held = holdRead(a.backend)
	const source = { noteId: a.noteId },
		time = new Date(createdAt),
		binding = { ...a.scope }
	const actor = createActor(createDocumentNotePreview(held, binding), {
		input: { source, createdAt: time }
	}).start()
	const result = toPromise(actor)
	try {
		await held.entered
		source.noteId = crypto.randomUUID()
		time.setUTCFullYear(2000)
		binding.publishingDid = 'did:web:changed.example'
		await a.backend.update(app.notes, a.noteId, { text: 'Newer edit' }).wait({ tier: 'global' })
		held.release()
		expect(await result).toMatchObject({
			source: { noteId: a.noteId },
			publishingDid,
			record: { body: { value: 'My private note 🦊' }, createdAt: createdAt.toISOString() }
		})
		expect((await preview(a))?.record).toMatchObject({ body: { value: 'Newer edit' } })
	} finally {
		held.release()
		actor.stop()
	}
})
