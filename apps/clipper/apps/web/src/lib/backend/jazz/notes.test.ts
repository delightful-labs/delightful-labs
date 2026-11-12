import { policySchema } from './schema-permissions.test-support.js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import { projectNote, storedNoteHistorySchema } from '../../notes/schema.js'
import type { NoteRevision } from '../../notes/schema.js'
import { noteAttempt } from './note-attempt.test-support.js'
let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => fixture?.shutdown())
async function owner(name: string) {
	const session = { user_id: name, authMode: 'local-first', claims: {} } satisfies PolicyTestSession
	const db = fixture.as(session),
		libraryId = fixture.accountFor(session)
	await db
		.upsert(app.libraries, libraryId, { ownerId: libraryId, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	const records = createLibraryRecords(db, libraryId, () => true)
	const article = await toPromise(
		createActor(records.articles.saveMachine, {
			input: { url: `https://example.com/${name}` }
		}).start()
	)
	if (article.kind !== 'saved') throw new Error('Expected article')
	await Promise.all(article.receipts.map((receipt) => receipt.global()))
	const noteId = crypto.randomUUID(),
		documentId = article.operationId
	const result = await toPromise(
		createActor(records.notes.create, {
			input: noteAttempt({ id: noteId, libraryId, documentId })
		}).start()
	)
	if (result.settlement.kind !== 'locallyPersisted') throw new Error('Expected note entity')
	await result.settlement.workspace.global()
	return { db, libraryId, records, noteId, documentId }
}
function revision(
	account: Awaited<ReturnType<typeof owner>>,
	text: string,
	parents: string[] = []
): NoteRevision {
	return {
		id: crypto.randomUUID(),
		libraryId: account.libraryId,
		noteId: account.noteId,
		text,
		parents,
		editedAt: new Date().toISOString()
	}
}
async function write(account: Awaited<ReturnType<typeof owner>>, draft: NoteRevision) {
	const result = await toPromise(
		createActor(account.records.notes.stage, { input: noteAttempt(draft) }).start()
	)
	if (result.settlement.kind === 'locallyPersisted') await result.settlement.workspace.global()
	return result
}
it('keeps an independently addressable note and preserves conflicting native text revisions', async () => {
	const a = await owner('note-entity-owner'),
		b = await owner('note-entity-other')
	expect(a.noteId).not.toBe(a.documentId)
	expect(await a.records.notes.read(a.noteId)).toMatchObject({
		id: a.noteId,
		documentId: a.documentId
	})
	expect(await a.records.notes.forDocument(a.documentId)).toHaveLength(1)
	const base = revision(a, 'base'),
		first = revision(a, 'device A', [base.id]),
		second = revision(a, 'device B', [base.id])
	for (const row of [base, first, second])
		expect((await write(a, row)).settlement.kind).toBe('locallyPersisted')
	const clear = revision(a, '', [first.id])
	await write(a, clear)
	const rows = storedNoteHistorySchema.parse(
		await a.db.all(app.noteRevisions.where({ libraryId: a.libraryId }))
	)
	const projected = projectNote({ libraryId: a.libraryId, noteId: a.noteId }, rows)
	expect(projected.conflicted).toBe(true)
	expect(projected.versions.map((row) => row.text).sort()).toEqual(['', 'device B'])
	const resolved = revision(
		a,
		'retained',
		projected.heads.map((row) => row.id)
	)
	await write(a, resolved)
	expect(await a.records.notes.readRevision(resolved)).toEqual(resolved)
	await expect(a.records.notes.readRevision({ ...resolved, text: 'wrong intent' })).rejects.toThrow(
		'Invalid note operation'
	)
	expect((await write(a, resolved)).outcome).toBe('blocked')
	expect(await b.records.notes.read(a.noteId)).toBeNull()
	expect(await b.db.all(app.noteRevisions.where({ libraryId: a.libraryId }))).toEqual([])
	await expect(
		a.db.update(app.noteRevisions, base.id, { text: 'overwrite' }).wait({ tier: 'global' })
	).rejects.toThrow()
	await expect(a.db.delete(app.noteRevisions, base.id).wait({ tier: 'global' })).rejects.toThrow()
	await expect(
		b.db
			.insert(app.noteRevisions, {
				libraryId: b.libraryId,
				noteId: a.noteId,
				text: 'foreign',
				parents: '[]',
				editedAt: new Date().toISOString()
			})
			.wait({ tier: 'global' })
	).rejects.toThrow()
})
it('checks note ownership and causal references inside the transaction and preserves note identity on repeated creation', async () => {
	const a = await owner('note-entity-validation'),
		b = await owner('note-entity-validation-other')
	const base = revision(a, 'base')
	await write(a, base)
	for (const row of [
		{ ...revision(a, 'missing'), noteId: crypto.randomUUID() },
		revision(a, 'missing base', [crypto.randomUUID()]),
		{ ...revision(b, 'cross-note', [base.id]), libraryId: a.libraryId },
		{ ...revision(a, 'cross-library'), libraryId: b.libraryId }
	])
		expect((await write(a, row)).settlement.kind).not.toBe('locallyPersisted')
	const duplicate = await toPromise(
		createActor(a.records.notes.create, {
			input: noteAttempt({
				id: crypto.randomUUID(),
				libraryId: a.libraryId,
				documentId: a.documentId
			})
		}).start()
	)
	expect(duplicate.outcome).toBe('blocked')
	expect((await a.records.notes.forDocument(a.documentId))[0]?.id).toBe(a.noteId)
})
it('rejects native note/revision access to foreign or missing parents', async () => {
	const a = await owner('note-entity-parent'),
		b = await owner('note-entity-parent-other')
	for (const fields of [
		{ libraryId: b.libraryId, documentId: a.documentId },
		{ libraryId: a.libraryId, documentId: crypto.randomUUID() }
	]) {
		const db = fields.libraryId === b.libraryId ? b.db : a.db
		await expect(db.insert(app.notes, fields).wait({ tier: 'global' })).rejects.toThrow()
	}
	await expect(
		a.db.update(app.notes, a.noteId, { documentId: b.documentId }).wait({ tier: 'global' })
	).rejects.toThrow()
	await expect(a.db.delete(app.notes, a.noteId).wait({ tier: 'global' })).rejects.toThrow()
})
it('rejects invalid stored revision batches without publishing partial state', async () => {
	const a = await owner('note-entity-invalid'),
		next = vi.fn(),
		error = vi.fn()
	const stop = a.records.notes.subscribe(next, error)
	await expect.poll(() => next.mock.calls.length).toBeGreaterThan(0)
	const count = next.mock.calls.length
	await a.db
		.insert(app.noteRevisions, {
			libraryId: a.libraryId,
			noteId: a.noteId,
			text: 'private',
			parents: 'invalid',
			editedAt: new Date().toISOString()
		})
		.wait({ tier: 'global' })
	await expect.poll(() => error.mock.calls.length).toBeGreaterThan(0)
	expect(next.mock.calls.length).toBe(count)
	stop()
})
