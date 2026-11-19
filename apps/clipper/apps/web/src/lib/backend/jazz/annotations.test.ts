import { beforeAll, afterAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './jazz.generated.js'
import permissions from './jazz.permissions.json' with { type: 'json' }
import { createLibraryRecords } from './records.js'
import { newDocumentValues } from './document-values.js'
import type { AnnotationMutation } from '../../annotations/schema.js'
import { annotationRecoveryMachine, selectAnnotationRecovery } from '../../annotations/recovery.js'
import type { NoteDraftRecord } from '../../notes/schema.js'
import { annotationsMachine, selectAnnotations } from '../../annotations/machine.js'
import { toTextPositionSelector, toTextQuoteSelector } from '../../annotations/selectors.js'
import { toMarginDocumentNote, toMarginHighlight } from '../../annotations/margin.js'
import {
	annotationNoteRowSchema,
	highlightRowSchema,
	textFingerprint
} from '../../annotations/schema.js'
let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
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
	if (!anchor) throw new Error('Expected native anchor')
	expect(toTextQuoteSelector(anchor.range).exact).toBe('café 🦊 passage ')
	expect(toTextPositionSelector(anchor.range, text)).toEqual({
		type: 'TextPositionSelector',
		start: 2,
		end: 17
	})
	const note = await mutate(a, { type: 'ADD_NOTE', documentId: a.documentId, highlightId }),
		id = note.prepared.id
	expect(note.result.outcome).toBe('succeeded')
	expect(await a.db.one(app.notes.where({ id }))).toMatchObject({
		documentId: a.documentId,
		highlightId
	})
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
it('enforces the same document for an attached note and its highlight in native permissions', async () => {
	const a = await owner('annotation-document-parent'),
		otherDocumentId = crypto.randomUUID()
	await a.db
		.insert(app.libraryDocuments, newDocumentValues(otherDocumentId, a.libraryId, null), {
			id: otherDocumentId
		})
		.wait({ tier: 'global' })
	const highlight = await mutate(a, {
		type: 'HIGHLIGHT',
		documentId: a.documentId,
		text: 'Selected passage',
		start: 0,
		end: 8
	})
	await expect(
		a.db
			.insert(app.notes, {
				libraryId: a.libraryId,
				documentId: otherDocumentId,
				highlightId: highlight.prepared.id
			})
			.wait({ tier: 'global' })
	).rejects.toThrow()
	const note = await mutate(a, {
		type: 'ADD_NOTE',
		documentId: a.documentId,
		highlightId: highlight.prepared.id
	})
	expect(note.result.outcome).toBe('succeeded')
	expect(
		(
			await mutate(a, {
				type: 'ADD_NOTE',
				documentId: a.documentId,
				highlightId: highlight.prepared.id
			})
		).result.outcome
	).toBe('blocked')
	await expect(
		a.db
			.update(app.notes, note.prepared.id, {
				documentId: otherDocumentId
			})
			.wait({ tier: 'global' })
	).rejects.toThrow()
})
it('projects native document notes and verified source anchors while refusing reader substitution', async () => {
	const a = await owner('annotation-margin'),
		text = 'A café 🦊 passage worth keeping.',
		createdAt = new Date('2026-11-14T12:00:00Z')
	const note = await mutate(a, { type: 'ADD_NOTE', documentId: a.documentId })
	await mutate(a, {
		type: 'EDIT_NOTE',
		documentId: a.documentId,
		id: note.prepared.id,
		text: 'A native note',
		editedFrom: ''
	})
	const storedNote = annotationNoteRowSchema.parse(
		await a.db.one(app.notes.where({ id: note.prepared.id }))
	)
	expect(toMarginDocumentNote(storedNote, createdAt)).toEqual({
		$type: 'at.margin.note',
		motivation: 'commenting',
		target: { source: 'https://example.com/annotation-margin' },
		body: { value: 'A native note', format: 'text/plain' },
		createdAt: '2026-11-14T12:00:00.000Z'
	})
	const created = await mutate(a, {
		type: 'HIGHLIGHT',
		documentId: a.documentId,
		text,
		start: 2,
		end: 18
	})
	const sourceAnchorId = crypto.randomUUID()
	await a.db
		.insert(
			app.highlightAnchors,
			{
				highlightId: created.prepared.id,
				kind: 'source',
				normalizationVersion: 'source-fixture-v1',
				textHash: await textFingerprint(text),
				range: a.db.textAnchors().captureRange(text, 2, 18),
				sourceDate: createdAt,
				textLengthCodePoints: Array.from(text).length,
				sourceCodePointPosition: { start: 2, end: 17 }
			},
			{ id: sourceAnchorId }
		)
		.wait({ tier: 'global' })
	const storedHighlight = highlightRowSchema.parse(
		await a.db.one(
			app.highlights.where({ id: created.prepared.id }).include({ anchors: true, notes: true })
		)
	)
	await expect(
		toMarginHighlight(storedHighlight, created.prepared.anchorId, text, createdAt)
	).rejects.toThrow()
	const record = await toMarginHighlight(storedHighlight, sourceAnchorId, text, createdAt)
	expect(record.motivation).toBe('highlighting')
	expect(record.target.selector?.exact).toBe('café 🦊 passage ')
	expect(record.target.source).toBe('https://example.com/annotation-margin')
	expect(record).not.toHaveProperty('id')
	expect(record).not.toHaveProperty('libraryId')
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

it('does not let an older note receipt report a queued edit as synced', async () => {
	const a = await owner('annotation-feedback')
	const gate = Promise.withResolvers<void>()
	const actor = createActor(annotationsMachine, {
		input: {
			capability: {
				...a.records.annotations,
				prepare: async (command) => {
					if (command.type === 'EDIT_NOTE') await gate.promise
					return a.records.annotations.prepare(command)
				}
			}
		}
	}).start()
	try {
		actor.send({ type: 'OPEN', documentId: a.documentId, text: 'Saved text.' })
		await expect.poll(() => selectAnnotations(actor.getSnapshot()).enabled).toBe(true)
		actor.send({ type: 'ADD_NOTE', documentId: a.documentId })
		await expect.poll(() => selectAnnotations(actor.getSnapshot()).notes.length).toBe(1)
		const note = selectAnnotations(actor.getSnapshot()).notes[0]
		if (!note) throw new Error('Missing note')
		const creation = actor.getSnapshot().context.receiptId
		actor.send({
			type: 'EDIT_NOTE',
			documentId: a.documentId,
			id: note.id,
			text: 'New edit.',
			editedFrom: ''
		})
		actor.send({ type: 'SYNC', id: creation, status: 'accepted' })
		expect(selectAnnotations(actor.getSnapshot()).pending).toBe(true)
		expect(selectAnnotations(actor.getSnapshot()).message?.text).not.toBe('note synced')
	} finally {
		gate.resolve()
		actor.send({ type: 'SHUTDOWN' })
		await toPromise(actor)
	}
})

it('keeps recovery removal behind every admitted draft and drains before shutdown', async () => {
	const a = await owner('annotation-draft-removal')
	const first = Promise.withResolvers<void>(),
		second = Promise.withResolvers<void>()
	const writes: NoteDraftRecord[] = [],
		removed: NoteDraftRecord[] = []
	const noteId = crypto.randomUUID(),
		writerId = crypto.randomUUID()
	const actor = createActor(annotationRecoveryMachine, {
		input: {
			capability: {
				...a.records.annotations,
				recovery: {
					libraryId: a.libraryId,
					writerId,
					store: {
						read: async () => [],
						write: async (record) => {
							writes.push(record)
							await (record.draft.sequence === 1 ? first.promise : second.promise)
						},
						remove: async (record) => {
							removed.push(record)
						}
					}
				}
			}
		}
	}).start()
	try {
		actor.send({ type: 'RETAIN', noteId, text: 'first' })
		actor.send({ type: 'RETAIN', noteId, text: 'second' })
		actor.send({ type: 'FORGET', noteId, writerId, text: 'second' })
		expect(selectAnnotationRecovery(actor.getSnapshot()).pending).toBe(true)
		expect(removed).toEqual([])
		first.resolve()
		await expect.poll(() => writes.length).toBe(2)
		expect(removed).toEqual([])
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		second.resolve()
		await toPromise(actor)
		expect(removed.map((record) => record.draft.text)).toEqual(['second'])
	} finally {
		first.resolve()
		second.resolve()
		actor.stop()
	}
})

it('admits preview only after recovery for the current A → B → A document generation', async () => {
	const a = await owner('annotation-recovery-generation')
	const created = await mutate(a, { type: 'ADD_NOTE', documentId: a.documentId })
	const reads = [
		Promise.withResolvers<{ id: string; text: string }[]>(),
		Promise.withResolvers<{ id: string; text: string }[]>(),
		Promise.withResolvers<{ id: string; text: string }[]>()
	]
	let count = 0
	const actor = createActor(annotationsMachine, {
		input: {
			capability: {
				...a.records.annotations,
				recoveryTargets: () => {
					const read = reads[count++]
					if (!read) throw new Error('Unexpected recovery read')
					return read.promise
				},
				recovery: {
					libraryId: a.libraryId,
					writerId: crypto.randomUUID(),
					store: {
						read: async () => [],
						write: async () => {},
						remove: async () => {}
					}
				}
			}
		}
	}).start()
	const views: ReturnType<typeof selectAnnotations>[] = []
	const subscription = actor.subscribe((snapshot) => views.push(selectAnnotations(snapshot)))
	try {
		actor.send({ type: 'OPEN', documentId: a.documentId, text: 'Saved text.' })
		actor.send({ type: 'OPEN', documentId: crypto.randomUUID(), text: 'Another document.' })
		actor.send({ type: 'OPEN', documentId: a.documentId, text: 'Saved text.' })
		await expect.poll(() => selectAnnotations(actor.getSnapshot()).notes.length).toBe(1)
		reads[0]?.resolve([])
		reads[1]?.resolve([])
		await Promise.all(reads.slice(0, 2).map((read) => read.promise))
		actor.send({ type: 'PREVIEW_NOTE', documentId: a.documentId, id: created.prepared.id })
		expect(selectAnnotations(actor.getSnapshot()).enabled).toBe(false)
		expect(selectAnnotations(actor.getSnapshot()).preview.source).toBeUndefined()
		reads[2]?.resolve([])
		await expect.poll(() => selectAnnotations(actor.getSnapshot()).enabled).toBe(true)
		expect(views.some((view) => view.enabled && view.notes.length === 1)).toBe(true)
		actor.send({ type: 'PREVIEW_NOTE', documentId: a.documentId, id: created.prepared.id })
		expect(selectAnnotations(actor.getSnapshot()).preview.source).toEqual({
			noteId: created.prepared.id
		})
	} finally {
		for (const read of reads) read.resolve([])
		actor.send({ type: 'SHUTDOWN' })
		await toPromise(actor)
		subscription.unsubscribe()
	}
})
