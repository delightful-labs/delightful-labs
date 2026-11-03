import { describe, expect, it } from 'vitest'
import {
	ArchivePayloadError,
	encodeArchivePayload,
	parseArchivePayload,
	payloadLimits,
	type ArchivePayload,
	type PayloadLimitOverrides
} from './archive.js'

const utf8 = new TextEncoder()
const minimalWire =
	'{"archiveId":"12345678-1234-4234-8234-123456789abc","profile":{"id":"example.notes","version":1},"source":{"applicationId":"app","workspaceId":"workspace"},"capturedAt":"2026-11-03T12:34:56.789Z","coverage":{"mode":"complete-supported-graph","recordTypes":["note"],"history":"current-data","deletedRecords":"excluded","consistency":"quiescent-single-user"},"records":[],"attachments":[],"references":[]}'

function minimal(): ArchivePayload {
	return {
		archiveId: '12345678-1234-4234-8234-123456789abc',
		profile: { id: 'example.notes', version: 1 },
		source: { applicationId: 'app', workspaceId: 'workspace' },
		capturedAt: '2026-11-03T12:34:56.789Z',
		coverage: {
			mode: 'complete-supported-graph',
			recordTypes: ['note'],
			history: 'current-data',
			deletedRecords: 'excluded',
			consistency: 'quiescent-single-user'
		},
		records: [],
		attachments: [],
		references: []
	}
}

function withField(field: unknown) {
	return { ...minimal(), records: [{ type: 'note', id: 'n1', fields: { content: field } }] }
}

function sample(): ArchivePayload {
	return {
		...minimal(),
		coverage: { ...minimal().coverage, recordTypes: ['note', 'audit'] },
		records: [
			{
				type: 'note',
				id: 'n1',
				fields: {
					content: { kind: 'text', value: 'Private example 😀' },
					amount: { kind: 'integer', value: '-9007199254740993' },
					date: { kind: 'date', value: '2024-02-29' },
					time: { kind: 'timestamp', value: '2026-11-03T12:34:56.789Z' },
					archived: { kind: 'boolean', value: true },
					empty: { kind: 'null' },
					file: { kind: 'attachment', id: 'file' },
					audit: { kind: 'reference', type: 'audit', id: 'a1' }
				}
			}
		],
		references: [
			{
				type: 'audit',
				id: 'a1',
				fields: { original: { kind: 'reference', type: 'note', id: 'n1' } }
			}
		],
		attachments: [
			{
				id: 'file',
				fileName: 'example.txt',
				mediaType: 'text/plain',
				sizeBytes: 2,
				data: 'aGk=',
				sha256: '0'.repeat(64)
			}
		]
	}
}

function rejects(input: unknown, overrides: PayloadLimitOverrides = {}) {
	expect(() => encodeArchivePayload(input, overrides)).toThrow(ArchivePayloadError)
	expect(() => parseArchivePayload(utf8.encode(JSON.stringify(input)), overrides)).toThrow(
		ArchivePayloadError
	)
}

describe('archive payload interoperability and preservation', () => {
	it('reads independent wire data and preserves all supported exact values', () => {
		expect(parseArchivePayload(utf8.encode(minimalWire))).toEqual(minimal())
		const original = sample()
		const parsed = parseArchivePayload(encodeArchivePayload(original))
		expect(parsed).toEqual({
			...original,
			coverage: { ...original.coverage, recordTypes: ['audit', 'note'] }
		})
		expect(parsed.records[0]?.fields.amount).toEqual({
			kind: 'integer',
			value: '-9007199254740993'
		})
		// A syntactically valid digest is not claimed verified by this structural codec.
		expect(parsed.attachments[0]?.sha256).toBe('0'.repeat(64))
	})

	it('preserves prototype-named and numeric field keys without pollution or reordering', () => {
		const fields = Object.fromEntries(
			['__proto__', 'constructor', 'prototype', '2', '10'].map((key) => [
				key,
				{ kind: 'text', value: key }
			])
		)
		const input = { ...minimal(), records: [{ type: 'note', id: 'n1', fields }] }
		const bytes = encodeArchivePayload(input)
		const parsed = parseArchivePayload(bytes)
		const output = parsed.records[0]?.fields
		expect(output).toEqual(fields)
		expect(Object.hasOwn(output ?? {}, '__proto__')).toBe(true)
		expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
		const wire = new TextDecoder().decode(bytes)
		expect(wire.indexOf('"10":')).toBeLessThan(wire.indexOf('"2":'))
		expect(Object.hasOwn(Object.prototype, 'kind')).toBe(false)
	})

	it('sorts record and attachment arrays independently of their input order', () => {
		const row = (id: string) => ({ type: 'note', id, fields: {} })
		const file = (id: string) => ({
			id,
			fileName: '',
			mediaType: 'application/octet-stream',
			sizeBytes: 0,
			data: '',
			sha256: '0'.repeat(64)
		})
		const first = {
			...minimal(),
			records: [row('b'), row('a')],
			attachments: [file('b'), file('a')]
		}
		const second = {
			...minimal(),
			records: [row('a'), row('b')],
			attachments: [file('a'), file('b')]
		}
		expect(encodeArchivePayload(first)).toEqual(encodeArchivePayload(second))
		expect(encodeArchivePayload(parseArchivePayload(encodeArchivePayload(first)))).toEqual(
			encodeArchivePayload(first)
		)
	})

	it('detaches input data and freezes every returned object', () => {
		const field = { kind: 'text', value: 'original' }
		const input = withField(field)
		const parsed = parseArchivePayload(encodeArchivePayload(input))
		field.value = 'changed'
		expect(parsed.records[0]?.fields.content).toEqual({ kind: 'text', value: 'original' })
		function frozen(value: unknown) {
			if (typeof value !== 'object' || value === null) return
			expect(Object.isFrozen(value)).toBe(true)
			for (const child of Object.values(value)) frozen(child)
		}
		frozen(parsed)
		expect(Reflect.set(parsed.profile, 'id', 'replacement')).toBe(false)
	})
})

describe('strict JSON input', () => {
	it.each([
		'',
		'{} trailing',
		'{}{}',
		'{"a":1,}',
		'[1,]',
		'{"a":01}',
		'{"a":+1}',
		'{"a":NaN}',
		'{"a":1e9999}',
		'{"a":"\\x20"}',
		'{"a":"unterminated}',
		'{"a":"raw\nnewline"}',
		'{"a":true false}',
		'{"a" 1}',
		'{"a":undefined}'
	])('rejects malformed/trailing JSON: %s', (wire) => {
		expect(() => parseArchivePayload(utf8.encode(wire))).toThrow(ArchivePayloadError)
	})

	it.each([
		'{"profile":{},"profile":{}}',
		String.raw`{"profile":{},"\u0070rofile":{}}`,
		String.raw`{"fields":{"a":1,"\u0061":2}}`,
		'{"__proto__":1,"__proto__":2}'
	])('rejects duplicate keys before schema validation: %s', (wire) => {
		expect(() => parseArchivePayload(utf8.encode(wire))).toThrow('duplicateKey')
	})

	it('rejects BOM and invalid UTF-8 without replacement decoding', () => {
		expect(() => parseArchivePayload(utf8.encode(`\ufeff${minimalWire}`))).toThrow(
			'invalidEncoding'
		)
		expect(() => parseArchivePayload(new Uint8Array([0xc0, 0xaf]))).toThrow('invalidEncoding')
	})

	it.each(['1.0000000000000001', '1e0', '1.0', '-0', '9007199254740993'])(
		'rejects metadata numbers that are not canonical safe integer tokens: %s',
		(token) => {
			const wire = minimalWire.replace('"version":1', `"version":${token}`)
			expect(() => parseArchivePayload(utf8.encode(wire))).toThrow('invalidJson')
		}
	)

	it('bounds nested JSON and node count before schema validation', () => {
		expect(() => parseArchivePayload(utf8.encode('['.repeat(33) + '0' + ']'.repeat(33)))).toThrow(
			'limitExceeded'
		)
		expect(() => parseArchivePayload(utf8.encode(minimalWire), { jsonValues: 5 })).toThrow(
			'limitExceeded'
		)
		expect(() => encodeArchivePayload(minimal(), { jsonValues: 5 })).toThrow('limitExceeded')
	})
})

describe('exact shape and value rules', () => {
	it.each(['-0', '01', '+1', '1.0', '1e3', ' 1', '', '1'.repeat(129)])(
		'rejects noncanonical integers: %s',
		(value) => {
			rejects(withField({ kind: 'integer', value }))
		}
	)
	it.each(['0', '-1', '1'.repeat(128), '-' + '1'.repeat(128)])(
		'preserves canonical integers: %s',
		(value) => {
			expect(
				parseArchivePayload(encodeArchivePayload(withField({ kind: 'integer', value }))).records[0]
					?.fields.content
			).toEqual({ kind: 'integer', value })
		}
	)
	it.each(['1900-02-29', '2023-02-29', '2024-02-30', '2024-04-31', '2024-1-01'])(
		'rejects invalid dates: %s',
		(value) => {
			rejects(withField({ kind: 'date', value }))
		}
	)
	it.each([
		'2026-11-03T12:34:56Z',
		'2026-11-03T12:34:56.1234Z',
		'2026-11-03T12:34:56.789+00:00',
		'2026-02-30T12:34:56.789Z'
	])('rejects noncanonical timestamps: %s', (value) => {
		rejects(withField({ kind: 'timestamp', value }))
	})
	it.each([
		{ kind: 'text', value: '\ud800' },
		{ kind: 'text', value: '\udfff' },
		{ kind: 'boolean', value: 'false' },
		{ kind: 'integer', value: 1 },
		{ kind: 'null', value: null },
		{ kind: 'text', value: 'x', extra: true },
		{ kind: 'unknown', value: 'x' }
	])('rejects coercion, malformed Unicode and unknown shapes: %j', (field) =>
		rejects(withField(field))
	)
	it('rejects unknown payload fields and unsupported versions/modes', () => {
		rejects({ ...minimal(), secret: 'must not be stripped' })
		rejects({ ...minimal(), profile: { id: 'example.notes', version: 0 } })
		rejects({ ...minimal(), coverage: { ...minimal().coverage, history: 'all-history' } })
	})
	it('counts text bytes rather than UTF-16 characters', () => {
		const value = withField({ kind: 'text', value: '😀' })
		expect(() => encodeArchivePayload(value, { textBytes: 4 })).not.toThrow()
		rejects(value, { textBytes: 3 })
	})
})

describe('graph and attachment checks', () => {
	it('rejects missing records, undeclared types and duplicate identities across both arrays', () => {
		rejects(withField({ kind: 'reference', type: 'note', id: 'missing' }))
		rejects(withField({ kind: 'attachment', id: 'missing' }))
		const row = { type: 'note', id: 'n1', fields: {} }
		rejects({ ...minimal(), records: [row, row] })
		rejects({ ...minimal(), records: [row], references: [row] })
		rejects({ ...minimal(), records: [{ ...row, type: 'undeclared' }] })
		rejects({ ...minimal(), coverage: { ...minimal().coverage, recordTypes: ['note', 'note'] } })
	})
	it('does not collide identities containing delimiters', () => {
		const input = {
			...minimal(),
			coverage: { ...minimal().coverage, recordTypes: ['a:b', 'a'] },
			records: [
				{ type: 'a:b', id: 'c', fields: {} },
				{ type: 'a', id: 'b:c', fields: {} }
			]
		}
		expect(() => encodeArchivePayload(input)).not.toThrow()
	})
	it.each(['aGk', 'aGk===', 'AA=A', '_w==', 'aGk=\n', 'YR==', 'YWJ='])(
		'rejects noncanonical base64: %s',
		(data) => {
			const file = sample().attachments[0]
			if (!file) throw new Error('Missing fixture')
			rejects({ ...sample(), attachments: [{ ...file, data }] })
		}
	)
	it('rejects mismatched lengths, repeated file IDs and invalid digests', () => {
		const file = sample().attachments[0]
		if (!file) throw new Error('Missing fixture')
		rejects({ ...sample(), attachments: [{ ...file, sizeBytes: 3 }] })
		rejects({ ...sample(), attachments: [file, file] })
		rejects({ ...sample(), attachments: [{ ...file, sha256: 'F'.repeat(64) }] })
	})
	it('enforces per-file bytes, total bytes, attachment count and combined record count', () => {
		const file = sample().attachments[0]
		if (!file) throw new Error('Missing fixture')
		rejects(sample(), { attachmentBytes: 1 })
		rejects(
			{ ...sample(), attachments: [file, { ...file, id: 'second' }] },
			{ totalAttachmentBytes: 3 }
		)
		rejects({ ...sample(), attachments: [file, { ...file, id: 'second' }] }, { attachments: 1 })
		const row = (id: string) => ({ type: 'note', id, fields: {} })
		rejects({ ...minimal(), records: [row('one')], references: [row('two')] }, { records: 1 })
	})
})

describe('resource limits and safe caller boundary', () => {
	it('accepts the exact encoded byte budget and refuses one byte less', () => {
		const bytes = encodeArchivePayload(minimal())
		expect(encodeArchivePayload(minimal(), { payloadBytes: bytes.length })).toEqual(bytes)
		expect(() => encodeArchivePayload(minimal(), { payloadBytes: bytes.length - 1 })).toThrow(
			'limitExceeded'
		)
		expect(() => parseArchivePayload(bytes, { payloadBytes: bytes.length - 1 })).toThrow(
			'limitExceeded'
		)
	})
	it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, payloadLimits.depth + 1])(
		'rejects invalid/raised limits: %s',
		(depth) => {
			expect(() => encodeArchivePayload(minimal(), { depth })).toThrow('limitExceeded')
			expect(() => parseArchivePayload(utf8.encode(minimalWire), { depth })).toThrow(
				'limitExceeded'
			)
		}
	)
	it('enforces field, name, ID, depth and Unicode-key limits', () => {
		rejects(
			{
				...minimal(),
				records: [{ type: 'note', id: 'n1', fields: { a: { kind: 'null' }, b: { kind: 'null' } } }]
			},
			{ fieldsPerRecord: 1 }
		)
		rejects(minimal(), { nameBytes: 3 })
		rejects(minimal(), { idBytes: 2 })
		rejects(sample(), { depth: 3 })
		rejects({
			...minimal(),
			records: [{ type: 'note', id: 'n1', fields: { '\ud800': { kind: 'null' } } }]
		})
	})
	it('does not execute getters or toJSON on caller data', () => {
		let calls = 0
		const getter = Object.defineProperty({}, 'value', {
			enumerable: true,
			get() {
				calls += 1
				return 'secret'
			}
		})
		expect(() => encodeArchivePayload(getter)).toThrow('invalidPayload')
		expect(() =>
			encodeArchivePayload({
				toJSON() {
					calls += 1
					return minimal()
				}
			})
		).toThrow('invalidPayload')
		expect(calls).toBe(0)
	})
	it('bounds cyclic/sparse data and rejects non-JSON caller values', () => {
		const cyclic: { child?: unknown } = {}
		cyclic.child = cyclic
		expect(() => encodeArchivePayload(cyclic)).toThrow('limitExceeded')
		const sparse: unknown[] = []
		sparse.length = 5
		expect(() => encodeArchivePayload(sparse)).toThrow(ArchivePayloadError)
		expect(() => encodeArchivePayload(new Date())).toThrow('invalidPayload')
		expect(() => encodeArchivePayload(withField({ kind: 'integer', value: 1n }))).toThrow(
			'invalidPayload'
		)
	})
	it('never includes record contents or Zod issues in public errors', () => {
		let error: unknown
		try {
			encodeArchivePayload(withField({ kind: 'secret-sentinel', value: 'private-sentinel' }))
		} catch (caught) {
			error = caught
		}
		expect(error).toBeInstanceOf(ArchivePayloadError)
		if (!(error instanceof ArchivePayloadError)) throw new Error('Missing expected error')
		expect(error.message).toBe('invalidPayload')
		expect(JSON.stringify(error)).not.toContain('sentinel')
		expect(Object.hasOwn(error, 'cause')).toBe(false)
	})
})
