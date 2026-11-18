import { expect, it } from 'vitest'
import { marginRecordSchema, toMarginDocumentNote, toMarginHighlight } from './margin.js'
import { annotationNoteRowSchema, textFingerprint } from './schema.js'
import type { AnnotationHighlight, AnnotationNote } from './schema.js'

const libraryId = crypto.randomUUID()
const documentId = crypto.randomUUID()
const source = 'https://example.org/article'
const createdAt = new Date('2026-11-14T12:00:00Z')
const modifiedAt = new Date('2026-11-14T12:01:00Z')

function documentNote(): AnnotationNote {
	return {
		id: crypto.randomUUID(),
		libraryId,
		documentId,
		highlightId: null,
		source,
		text: 'My note'
	}
}

async function highlight() {
	const id = crypto.randomUUID()
	const text = 'Before 🦊 selected passage after.'
	const anchor = {
		id: crypto.randomUUID(),
		highlightId: id,
		kind: 'source',
		normalizationVersion: 'source-fixture-v1',
		textHash: await textFingerprint(text),
		range: {
			before: 'Before 🦊 ',
			matched: 'selected passage',
			after: ' after.',
			start: text.indexOf('selected'),
			end: text.indexOf(' after.')
		}
	} satisfies AnnotationHighlight['anchors'][number]
	const snapshot: AnnotationHighlight = {
		id,
		libraryId,
		documentId,
		source,
		anchors: [anchor],
		notes: []
	}
	return { snapshot, anchor, text }
}

function attachedNote(parent: AnnotationHighlight): AnnotationNote {
	return { ...documentNote(), documentId: parent.documentId, source: null, highlightId: parent.id }
}

it('maps a document Note to the reviewed Margin shape without private fields', () => {
	expect(toMarginDocumentNote(documentNote(), createdAt)).toEqual({
		$type: 'at.margin.note',
		motivation: 'commenting',
		target: { source },
		body: { value: 'My note', format: 'text/plain' },
		createdAt: '2026-11-14T12:00:00.000Z'
	})
})

it('retains a cleared document Note as an empty commentary body', () => {
	expect(toMarginDocumentNote({ ...documentNote(), text: '' }, createdAt).body).toEqual({
		value: '',
		format: 'text/plain'
	})
})

it('uses supplied publication times and keeps the original creation time on updates', () => {
	const note = documentNote()
	const initial = toMarginDocumentNote(note, createdAt)
	const updated = toMarginDocumentNote({ ...note, text: 'Edited' }, createdAt, modifiedAt)
	expect(updated.createdAt).toBe(initial.createdAt)
	expect(updated.modifiedAt).toBe('2026-11-14T12:01:00.000Z')
	expect(initial).not.toHaveProperty('modifiedAt')
	expect(() => toMarginDocumentNote(note, new Date(NaN))).toThrow()
	expect(() => toMarginDocumentNote(note, createdAt, new Date(NaN))).toThrow()
})

it('refuses attached/malformed document parents and unsupported source URLs', () => {
	for (const changes of [
		{ highlightId: crypto.randomUUID() },
		{ source: null },
		{ source: 'at://example.org/private' },
		{ source: 'https://user:secret@example.org/article' }
	]) {
		expect(() => toMarginDocumentNote({ ...documentNote(), ...changes }, createdAt)).toThrow()
	}
	expect(annotationNoteRowSchema.safeParse({ ...documentNote(), documentId: null }).success).toBe(
		false
	)
})

it('refuses oversized native merged notes without altering or truncating their text', () => {
	for (const text of ['x'.repeat(3001), ('a' + '\u0301'.repeat(10)).repeat(500)]) {
		const note = { ...documentNote(), text }
		expect(() => toMarginDocumentNote(note, createdAt)).toThrow(
			'Annotation cannot be projected to Margin'
		)
		expect(note.text).toBe(text)
	}
})

it('maps a verified source Highlight to quotation-only Margin content', async () => {
	const { snapshot, anchor, text } = await highlight()
	expect(await toMarginHighlight(snapshot, anchor.id, text, createdAt)).toEqual({
		$type: 'at.margin.note',
		motivation: 'highlighting',
		target: {
			source,
			selector: {
				type: 'TextQuoteSelector',
				exact: 'selected passage',
				prefix: 'Before 🦊 ',
				suffix: ' after.'
			}
		},
		createdAt: '2026-11-14T12:00:00.000Z'
	})
})

it('combines an attached Note, and returns to bare highlight content when removed', async () => {
	const { snapshot, anchor, text } = await highlight()
	snapshot.notes = [attachedNote(snapshot)]
	const combined = await toMarginHighlight(snapshot, anchor.id, text, createdAt)
	expect(combined.motivation).toBe('commenting')
	expect(combined).toHaveProperty('body', { value: 'My note', format: 'text/plain' })
	snapshot.notes = []
	const bare = await toMarginHighlight(snapshot, anchor.id, text, createdAt, modifiedAt)
	expect(bare.motivation).toBe('highlighting')
	expect(bare).not.toHaveProperty('body')
	expect(bare.target).toEqual(combined.target)
	expect(bare.createdAt).toBe(combined.createdAt)
})

it('blocks reader-only and contradictory source evidence instead of guessing', async () => {
	const { snapshot, anchor, text } = await highlight()
	await expect(toMarginHighlight(snapshot, crypto.randomUUID(), text, createdAt)).rejects.toThrow()
	await expect(
		toMarginHighlight(snapshot, anchor.id, 'different text', createdAt)
	).rejects.toThrow()
	const changesToAnchors: Partial<AnnotationHighlight['anchors'][number]>[] = [
		{ kind: 'reader' },
		{ highlightId: crypto.randomUUID() },
		{ normalizationVersion: '' },
		{ textHash: '0'.repeat(64) },
		{ range: { ...anchor.range, start: 0 } },
		{
			range: {
				before: anchor.range.before,
				matched: anchor.range.matched,
				after: anchor.range.after
			}
		}
	]
	for (const changes of changesToAnchors) {
		await expect(
			toMarginHighlight(
				{ ...snapshot, anchors: [{ ...anchor, ...changes }] },
				anchor.id,
				text,
				createdAt
			)
		).rejects.toThrow()
	}
	await expect(
		toMarginHighlight({ ...snapshot, anchors: [anchor, anchor] }, anchor.id, text, createdAt)
	).rejects.toThrow()
})

it('blocks competing attached Notes and foreign or duplicated parent relationships', async () => {
	const { snapshot, anchor, text } = await highlight()
	const note = attachedNote(snapshot)
	for (const notes of [
		[note, { ...note, id: crypto.randomUUID() }],
		[{ ...note, libraryId: crypto.randomUUID() }],
		[{ ...note, highlightId: crypto.randomUUID() }],
		[{ ...note, documentId: crypto.randomUUID() }],
		[{ ...note, source }],
		[{ ...note, text: 'x'.repeat(3001) }]
	]) {
		await expect(
			toMarginHighlight({ ...snapshot, notes }, anchor.id, text, createdAt)
		).rejects.toThrow()
	}
})

it('does not absorb input edits while its representation digest is pending', async () => {
	const { snapshot, anchor, text } = await highlight()
	const note = attachedNote(snapshot)
	snapshot.notes = [note]
	const time = new Date(createdAt)
	const pending = toMarginHighlight(snapshot, anchor.id, text, time)
	note.text = 'Later local edit'
	anchor.range.matched = 'Different quote'
	time.setUTCFullYear(2030)
	const result = await pending
	expect(result).toHaveProperty('body.value', 'My note')
	expect(result.target.selector?.exact).toBe('selected passage')
	expect(result.createdAt).toBe('2026-11-14T12:00:00.000Z')
})

it('enforces the reviewed union and refuses unsupported remote fields', () => {
	const note = toMarginDocumentNote(documentNote(), createdAt)
	for (const invalid of [
		{ ...note, motivation: 'highlighting' },
		{ ...note, body: undefined },
		{ ...note, tags: ['foreign'] },
		{ ...note, target: { source, title: 'foreign' } },
		{ ...note, target: { source, selector: { type: 'CssSelector', value: 'p' } } },
		{
			...note,
			target: { source, selector: { type: 'TextQuoteSelector', exact: 'quote', refinedBy: {} } }
		}
	]) {
		expect(marginRecordSchema.safeParse(invalid).success).toBe(false)
	}
})
