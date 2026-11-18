import { expect, it } from 'vitest'
import { atRecordUriSchema, publicationDid, publicationSourceSchema } from './publication-link.js'

const highlightId = crypto.randomUUID()
const noteId = crypto.randomUUID()
const uri = 'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/at.margin.note/3jzfcijpj2z2a'

it('admits only full DID-based Margin record URIs, without selecting a DID method or key generator', () => {
	for (const value of [uri, 'at://did:web:user.example.com/at.margin.note/self']) {
		expect(atRecordUriSchema.safeParse(value).success).toBe(true)
	}
	expect(publicationDid(uri)).toBe('did:plc:ewvi7nxzyoun6zhxrhs64oiz')
	for (const value of [
		'https://example.com/note',
		'at://example.com/at.margin.note/key',
		'at://did:plc:example',
		'at://did:plc:example/at.margin.note',
		'at://did:plc:example/app.bsky.feed.post/key',
		'at://did:plc:example/at.margin.note/.',
		'at://did:plc:example/at.margin.note/..',
		'at://did:plc:example/at.margin.note/key/',
		'at://did:plc:example/at.margin.note/key#fragment',
		'at://did:plc:example/at.margin.note/key?query',
		'at://did:plc:example/at.margin.note/a%2Fb',
		'at://did:PLc:example/at.margin.note/key',
		'at://did:plc:example:/at.margin.note/key',
		`at://did:plc:example/at.margin.note/${'x'.repeat(513)}`,
		`at://did:plc:${'x'.repeat(2048)}/at.margin.note/key`
	]) {
		expect(atRecordUriSchema.safeParse(value).success).toBe(false)
	}
})

it('requires exactly one annotation root', () => {
	for (const source of [{ highlightId }, { noteId }]) {
		expect(publicationSourceSchema.parse(source)).toEqual(source)
	}
	for (const source of [{}, { highlightId, noteId }]) {
		expect(publicationSourceSchema.safeParse(source).success).toBe(false)
	}
})
