import { beforeAll, afterAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { policySchema } from './schema-permissions.test-support.js'
import { createLibraryRecords } from './records.js'
import type { AnnotationMutation } from '../../annotations/schema.js'
import { annotationsMachine, selectAnnotations } from '../../annotations/machine.js'
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
	const saved = await toPromise(
		createActor(records.articles.saveMachine, {
			input: {
				url: `https://example.com/${name}`,
				content: {
					title: 'Annotations',
					text: 'A café 🦊 passage worth keeping.',
					html: '<p>A café 🦊 passage worth keeping.</p>',
					finalUrl: `https://example.com/${name}`,
					provenance: '{}'
				}
			}
		}).start()
	)
	if (saved.kind !== 'saved') throw new Error('Expected saved document')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	return { db, libraryId, records, documentId: saved.operationId }
}
async function mutate(a: Awaited<ReturnType<typeof owner>>, command: AnnotationMutation) {
	const prepared = await a.records.annotations.prepare(command)
	const result = await toPromise(
		createActor(a.records.annotations.stage, {
			input: {
				attempt: {
					operationId: prepared.id,
					workspaceId: prepared.id,
					membershipId: prepared.id,
					draft: prepared
				}
			}
		}).start()
	)
	if (result.outcome === 'failed') throw result.error
	if (result.settlement.kind === 'locallyPersisted') await result.settlement.workspace.global()
	return { prepared, result }
}
it('uses native ranges, text/history and same-identity highlight restoration', async () => {
	const a = await owner('annotation-native'),
		text = 'A café 🦊 passage worth keeping.'
	const created = await mutate(a, {
		type: 'HIGHLIGHT',
		documentId: a.documentId,
		text,
		start: 2,
		end: 18
	})
	expect(created.result.outcome).toBe('succeeded')
	const highlightId = created.prepared.id,
		anchor = await a.db.one(app.highlightAnchors.where({ highlightId }))
	expect(anchor?.range.matched).toBe(text.slice(2, 18))
	const note = await mutate(a, { type: 'ADD_NOTE', documentId: a.documentId, highlightId }),
		id = note.prepared.id
	expect(note.result.outcome).toBe('succeeded')
	await mutate(a, {
		type: 'EDIT_NOTE',
		documentId: a.documentId,
		id,
		text: 'Remember this passage.',
		editedFrom: ''
	})
	await mutate(a, {
		type: 'EDIT_NOTE',
		documentId: a.documentId,
		id,
		text: 'Remember this excellent passage.',
		editedFrom: 'Remember this passage.'
	})
	expect((await a.db.one(app.notes.where({ id })))?.text).toBe('Remember this excellent passage.')
	expect(
		(await a.db.all(app.$history.notes.where({ id }).select('text'))).map((row) => row.text)
	).toContain('Remember this passage.')
	await mutate(a, { type: 'DELETE_HIGHLIGHT', documentId: a.documentId, id: highlightId })
	expect(await a.db.one(app.highlights.where({ id: highlightId }))).toBeNull()
	expect((await a.db.one(app.notes.where({ id })))?.text).toBe('Remember this excellent passage.')
	await mutate(a, { type: 'RESTORE_HIGHLIGHT', documentId: a.documentId, id: highlightId })
	expect((await a.db.one(app.highlights.where({ id: highlightId })))?.id).toBe(highlightId)
	expect((await a.db.one(app.highlightAnchors.where({ highlightId })))?.id).toBe(anchor?.id)
	await mutate(a, { type: 'DELETE_NOTE', documentId: a.documentId, id })
	expect(await a.db.one(app.notes.where({ id }))).toBeNull()
	expect(await a.db.one(app.highlights.where({ id: highlightId }))).not.toBeNull()
})
it('refuses foreign parents, duplicate notes, oversized edits and edits in Trash', async () => {
	const a = await owner('annotation-owner'),
		b = await owner('annotation-other')
	expect((await mutate(b, { type: 'ADD_NOTE', documentId: a.documentId })).result.outcome).toBe(
		'blocked'
	)
	const note = await mutate(a, { type: 'ADD_NOTE', documentId: a.documentId }),
		id = note.prepared.id
	expect((await mutate(a, { type: 'ADD_NOTE', documentId: a.documentId })).result.outcome).toBe(
		'blocked'
	)
	expect(
		(
			await mutate(a, {
				type: 'EDIT_NOTE',
				documentId: a.documentId,
				id,
				text: 'x'.repeat(3001),
				editedFrom: ''
			})
		).result.outcome
	).toBe('blocked')
	await expect(
		b.db.update(app.notes, id, { text: 'foreign' }).wait({ tier: 'global' })
	).rejects.toThrow()
	await a.db
		.update(app.libraryDocuments, a.documentId, { status: 'trashed', previousStatus: 'inbox' })
		.wait({ tier: 'global' })
	expect(
		(
			await mutate(a, {
				type: 'EDIT_NOTE',
				documentId: a.documentId,
				id,
				text: 'after Trash',
				editedFrom: ''
			})
		).result.outcome
	).toBe('blocked')
})
it('observes joined annotations and drains pending edits before shutdown', async () => {
	const a = await owner('annotation-drain'),
		text = 'A\r\ncafé 🦊 passage worth keeping.'
	const actor = createActor(annotationsMachine, {
		input: { capability: a.records.annotations }
	}).start()
	actor.send({ type: 'OPEN', documentId: a.documentId, text })
	await expect.poll(() => selectAnnotations(actor.getSnapshot()).enabled).toBe(true)
	actor.send({ type: 'HIGHLIGHT', documentId: a.documentId, text, start: 3, end: 19 })
	await expect.poll(() => selectAnnotations(actor.getSnapshot()).highlights.length).toBe(1)
	expect(selectAnnotations(actor.getSnapshot()).highlights[0]?.range).toEqual({ start: 3, end: 19 })
	const oldGeneration = actor.getSnapshot().context.observationGeneration
	actor.send({ type: 'CLOSE' })
	actor.send({ type: 'OPEN', documentId: a.documentId, text })
	actor.send({ type: 'OBSERVATION_FAILED', documentId: a.documentId, generation: oldGeneration })
	await expect.poll(() => selectAnnotations(actor.getSnapshot()).enabled).toBe(true)
	actor.send({ type: 'ADD_NOTE', documentId: a.documentId })
	await expect.poll(() => selectAnnotations(actor.getSnapshot()).notes.length).toBe(1)
	const note = selectAnnotations(actor.getSnapshot()).notes[0]
	if (!note) throw new Error('Missing native note')
	actor.send({
		type: 'EDIT_NOTE',
		documentId: a.documentId,
		id: note.id,
		text: 'Durable before shutdown.',
		editedFrom: ''
	})
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	expect((await a.db.one(app.notes.where({ id: note.id })))?.text).toBe('Durable before shutdown.')
})

it('uses Jazz edit-base merging for stale disjoint edits of the same note', async () => {
	const a = await owner('annotation-merge'),
		created = await mutate(a, { type: 'ADD_NOTE', documentId: a.documentId }),
		id = created.prepared.id
	const base = 'The red fox crossed the gate.'
	await mutate(a, { type: 'EDIT_NOTE', documentId: a.documentId, id, text: base, editedFrom: '' })
	await mutate(a, {
		type: 'EDIT_NOTE',
		documentId: a.documentId,
		id,
		text: 'The red dog crossed the gate.',
		editedFrom: base
	})
	await mutate(a, {
		type: 'EDIT_NOTE',
		documentId: a.documentId,
		id,
		text: 'The red fox crossed the field.',
		editedFrom: base
	})
	expect((await a.db.one(app.notes.where({ id })))?.text).toBe('The red dog crossed the field.')
})
