import { expect, it } from 'vitest'
import { matchesIssuedContent } from './compare.js'

const did = 'did:web:owner.example'
const uri = `at://${did}/at.margin.note/3jzfcijpj2z2a`
const record = {
	$type: 'at.margin.note',
	createdAt: '2026-11-17T12:00:00Z',
	motivation: 'commenting',
	target: { source: 'https://example.org/article' },
	body: { value: 'The frozen note 🖍️', format: 'text/plain' }
}
const issued = {
	libraryId: crypto.randomUUID(),
	source: { noteId: crypto.randomUUID() },
	publishingDid: did,
	state: 'issued',
	uri,
	record
}

it('matches frozen owned content while retaining independent foreign metadata', () => {
	const remote = {
		uri,
		value: {
			...record,
			target: { ...record.target, title: 'Another app title', sourceHash: 'indexing hash' },
			color: 'blue',
			tags: ['remote'],
			generator: { name: 'Another app' },
			rights: 'https://creativecommons.org/licenses/by/4.0/',
			facets: [
				{
					index: { byteStart: 0, byteEnd: 3 },
					features: [{ $type: 'app.example.link', uri: 'https://example.org' }]
				}
			],
			future: { retained: [true, null] }
		}
	}
	const before = structuredClone(remote)
	expect(matchesIssuedContent(issued, remote)).toBe(true)
	expect(remote).toEqual(before)
	expect(issued.record).toEqual(record)
})

it('compares objects structurally without requiring a property order or a CID', () => {
	const reordered = {
		body: { format: 'text/plain', value: record.body.value },
		target: record.target,
		motivation: record.motivation,
		createdAt: record.createdAt,
		$type: record.$type
	}
	expect(matchesIssuedContent(issued, { uri, value: reordered })).toBe(true)
})

it('detects changed owned values and missing/added owned fields without coercion', () => {
	const { body, ...withoutBody } = record
	for (const value of [
		{ ...record, body: { ...body, value: 'External edit' } },
		{ ...record, body: { ...body, format: 'text/html' } },
		{ ...record, body: { value: body.value } },
		{ ...record, body: { ...body, uri: 'https://example.org/other-body' } },
		{ ...record, target: { source: 'https://example.org/another-article' } },
		{
			...record,
			target: { ...record.target, selector: { type: 'TextQuoteSelector', exact: 'New passage' } }
		},
		{ ...record, target: { ...record.target, state: { sourceDate: record.createdAt } } },
		{ ...record, target: { ...record.target, unknownTargetMeaning: true } },
		{ ...record, motivation: 'tagging' },
		{ ...record, $type: 'at.margin.other' },
		{ ...record, createdAt: '2026-11-17T12:00:00.000Z' },
		{ ...record, modifiedAt: record.createdAt },
		withoutBody
	])
		expect(matchesIssuedContent(issued, { uri, value })).toBe(false)
})

it('compares quotations, context and selector additions without approximate matching', () => {
	const selector = {
		type: 'TextQuoteSelector',
		exact: 'Frozen quotation',
		prefix: 'Before ',
		suffix: ' after'
	}
	const highlight = {
		$type: record.$type,
		createdAt: record.createdAt,
		motivation: 'highlighting',
		target: { ...record.target, selector }
	}
	const frozen = { ...issued, source: { highlightId: crypto.randomUUID() }, record: highlight }
	expect(matchesIssuedContent(frozen, { uri, value: highlight })).toBe(true)
	for (const changed of [
		{ ...selector, exact: 'Frozen quotations' },
		{ ...selector, prefix: 'Elsewhere ' },
		{ ...selector, suffix: ' later' },
		{ ...selector, refinedBy: { type: 'FragmentSelector', value: 'page=2' } },
		{ ...selector, unknownSelectorMeaning: true }
	])
		expect(
			matchesIssuedContent(frozen, {
				uri,
				value: { ...highlight, target: { ...highlight.target, selector: changed } }
			})
		).toBe(false)
	expect(matchesIssuedContent(frozen, { uri, value: { ...highlight, body: record.body } })).toBe(
		false
	)
})

it('distinguishes input/binding failures and notFound observations from a content mismatch', () => {
	for (const frozen of [
		{ libraryId: issued.libraryId, source: issued.source, publishingDid: did, state: 'private' },
		{ libraryId: issued.libraryId, source: issued.source, publishingDid: did, state: 'requested' },
		{
			libraryId: issued.libraryId,
			source: issued.source,
			publishingDid: did,
			state: 'published',
			uri
		}
	])
		expect(() => matchesIssuedContent(frozen, { uri, value: record })).toThrow(
			'Publication content cannot be compared'
		)
	for (const remote of [
		{ uri: uri.replace('owner.example', 'other.example'), value: record },
		{ uri: uri.replace('3jzfcijpj2z2a', '3jzfcijpj2z2b'), value: record },
		{ status: 'notFound', uri },
		{ uri, value: null }
	])
		expect(() => matchesIssuedContent(issued, remote)).toThrow('PDS record cannot be read')
})
