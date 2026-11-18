import { expect, it } from 'vitest'
import { parsePdsRecord, pdsRecordSchema } from './pds-record.js'

const uri = 'at://did:web:owner.example/at.margin.note/3jzfcijpj2z2a'
const cid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const value = {
	$type: 'at.margin.note',
	motivation: 'commenting',
	createdAt: '2026-11-17T12:00:00Z',
	target: {
		source: 'https://example.org/article',
		title: 'Title retained by another app',
		selector: {
			type: 'TextQuoteSelector',
			exact: 'A quotation 🖍️',
			vendorHint: { offsets: [1, 2] }
		},
		futureTarget: { enabled: true, optional: null }
	},
	body: { value: 'A remote note', format: 'text/plain', uri: 'https://example.org/body' },
	color: 'blue',
	tags: ['remote tag'],
	facets: [
		{ index: { byteStart: 2, byteEnd: 8 }, features: [{ $type: 'app.example.feature', count: 3 }] }
	],
	generator: { name: 'Another annotation app', future: ['a', false, null] },
	rights: 'https://creativecommons.org/licenses/by/4.0/',
	unknownField: { link: { $link: cid }, bytes: { $bytes: 'AA==' } }
}

it('retains the complete remote JSON value, including unfamiliar nested metadata', () => {
	const wire = JSON.parse(JSON.stringify({ uri, cid, value }))
	const record = parsePdsRecord(wire, uri)
	expect(record).toEqual({ uri, cid, value })
	expect(JSON.parse(JSON.stringify(record.value))).toEqual(value)
	expect(wire).toEqual({ uri, cid, value })
})

it('accepts an existing record without a CID without treating it as absence', () => {
	expect(parsePdsRecord({ uri, value }, uri)).toEqual({ uri, value })
	// This boundary reads records beyond Clipper's supported motivations/content.
	// Unsupported content is for the reconciliation policy, never stripped here.
	const foreign = { $type: 'at.margin.note', motivation: 'tagging', body: { future: true } }
	expect(parsePdsRecord({ uri, value: foreign }, uri).value).toEqual(foreign)
})

it('refuses a lossy parse of unusual remote keys instead of silently stripping them', () => {
	for (const json of [
		'{"__proto__":{"remoteFlag":true},"body":{"value":"Retained"}}',
		'{"body":{"__proto__":{"remoteFlag":true},"value":"Retained"}}',
		'{"metadata":[{"__proto__":{"remoteFlag":true}}]}'
	]) {
		const value: unknown = JSON.parse(json)
		expect(() => parsePdsRecord({ uri, cid, value }, uri)).toThrow('PDS record cannot be read')
		expect(JSON.stringify(value)).toBe(json)
	}
	expect(Object.hasOwn(Object.prototype, 'remoteFlag')).toBe(false)
})

it('validates supplied CID syntax using the existing AT library', () => {
	expect(pdsRecordSchema.safeParse({ uri, cid, value }).success).toBe(true)
	for (const invalid of [null, '', 'not-a-cid', cid + '\n', cid.toUpperCase(), cid.slice(1), 42])
		expect(pdsRecordSchema.safeParse({ uri, cid: invalid, value }).success).toBe(false)
})

it('requires the exact retained address before exposing an observation', () => {
	for (const other of [
		uri.replace('owner.example', 'owner.example.attacker.example'),
		uri.replace('3jzfcijpj2z2a', '3jzfcijpj2z2b'),
		uri.replace('at.margin.note', 'app.bsky.feed.post'),
		uri + '/extra',
		'not-an-at-uri'
	])
		expect(() => parsePdsRecord({ uri: other, cid, value }, uri)).toThrow(
			'PDS record cannot be read'
		)
	expect(() => parsePdsRecord({ uri, cid, value }, 'invalid')).toThrow('PDS record cannot be read')
})

it('refuses malformed/error responses and non-JSON record values without leaking them', () => {
	for (const input of [
		null,
		{},
		{ error: 'RecordNotFound', message: 'Private provider details' },
		{ uri },
		{ uri, value: null },
		{ uri, value: [] },
		{ uri, value: 'text' },
		{ uri, value: { nested: { privateInput: undefined } } },
		{ uri, value: { number: Infinity } },
		{ uri, value: { time: new Date() } }
	])
		expect(() => parsePdsRecord(input, uri)).toThrow('PDS record cannot be read')
})
