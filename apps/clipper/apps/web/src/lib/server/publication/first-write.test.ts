import { expect, it } from 'vitest'
import { publicationSchema } from '../../annotations/publication.js'
import { firstPublicationWriteSchema, toFirstPublicationWrite } from './first-write.js'

const did = 'did:web:owner.example'
const key = '3jzfcijpj2z2a'
const record = {
	$type: 'at.margin.note',
	createdAt: '2026-11-17T12:00:00Z',
	motivation: 'commenting',
	target: { source: 'https://example.org/article' },
	body: { value: 'Frozen note 🖍️', format: 'text/plain' }
}
const base = {
	libraryId: crypto.randomUUID(),
	source: { noteId: crypto.randomUUID() },
	publishingDid: did
}
const issued = { ...base, state: 'issued', uri: `at://${did}/at.margin.note/${key}`, record }

it('prepares only the retained destination, exact payload and required absence condition', () => {
	const write = toFirstPublicationWrite(issued)
	expect(write).toEqual({
		repo: did,
		collection: 'at.margin.note',
		rkey: key,
		record,
		swapRecord: null
	})
	expect(JSON.parse(JSON.stringify(write))).toEqual(write)
	expect(write.record.createdAt).toBe('2026-11-17T12:00:00Z')
	// The prepared request is a detached value: later caller mutation cannot change
	// its frozen content, and it contains no Jazz identities or lifecycle fields.
	const separate = structuredClone(issued)
	const prepared = toFirstPublicationWrite(separate)
	separate.record.body.value = 'Later local edit'
	expect(prepared.record).toEqual(record)
})

it('requires explicit null and refuses overrides or private fields in the wire body', () => {
	const write = toFirstPublicationWrite(issued)
	const { swapRecord, ...unguarded } = write
	expect(swapRecord).toBeNull()
	for (const input of [
		unguarded,
		{ ...write, swapRecord: undefined },
		{ ...write, swapRecord: 'previous-cid' },
		{ ...write, swapCommit: 'another-condition' },
		{ ...write, collection: 'app.bsky.feed.post' },
		{ ...write, repo: 'owner.example' },
		{ ...write, libraryId: base.libraryId },
		{ ...write, record: { ...record, noteId: base.source.noteId } }
	])
		expect(firstPublicationWriteSchema.safeParse(input).success).toBe(false)
})

it('accepts the TID alphabet and leading-bit bounds while refusing other record keys', () => {
	const write = toFirstPublicationWrite(issued)
	for (const rkey of ['2222222222222', 'jzzzzzzzzzzzz', key])
		expect(firstPublicationWriteSchema.safeParse({ ...write, rkey }).success).toBe(true)
	for (const rkey of [
		'self',
		'k222222222222',
		'zzzzzzzzzzzzz',
		'3jzfcijpj2z2',
		'3jzfcijpj2z2aa',
		'3JZFCIJPJ2Z2A',
		'3jzfcijpj2z20',
		'3jzfcijpj2z21',
		'3jzf-cijpj2z2',
		'3jzfcijpj2z2a\n'
	]) {
		expect(firstPublicationWriteSchema.safeParse({ ...write, rkey }).success).toBe(false)
		expect(() =>
			toFirstPublicationWrite({ ...issued, uri: `at://${did}/at.margin.note/${rkey}` })
		).toThrow('Publication cannot prepare a first write')
	}
	// Existing/foreign records are still readable with a generic valid record key;
	// they are not silently turned into new Margin writes or assigned a new key.
	expect(
		publicationSchema.safeParse({ ...issued, uri: `at://${did}/at.margin.note/self` }).success
	).toBe(true)
})

it('refuses mismatched destinations and every lifecycle except issued', () => {
	for (const input of [
		{ ...base, state: 'private' },
		{ ...base, state: 'requested' },
		{ ...base, state: 'published', uri: issued.uri },
		{ ...issued, publishingDid: 'did:web:another.example' },
		{ ...issued, uri: `at://${did}/app.bsky.feed.post/${key}` },
		{ ...issued, uri: issued.uri + '/extra' },
		{ ...issued, record: undefined }
	])
		expect(() => toFirstPublicationWrite(input)).toThrow('Publication cannot prepare a first write')
})

it('retains an approved highlight payload without introducing another public record', () => {
	const highlightRecord = {
		$type: 'at.margin.note',
		createdAt: record.createdAt,
		motivation: 'highlighting',
		target: {
			source: 'https://example.org/article',
			selector: { type: 'TextQuoteSelector', exact: 'Frozen quotation' }
		}
	}
	expect(
		toFirstPublicationWrite({
			...issued,
			source: { highlightId: crypto.randomUUID() },
			record: highlightRecord
		}).record
	).toEqual(highlightRecord)
})
