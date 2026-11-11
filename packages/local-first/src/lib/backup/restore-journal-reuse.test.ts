import { describe, expect, it } from 'vitest'
import wire from '../../../tests/fixtures/restore-journal-v1.json'
import {
	createRestoreJournalRecord,
	decodeRestoreJournalRecord,
	encodeRestoreJournalRecord,
	matchRestoreJournalIntent,
	parseRestoreJournalRecord
} from './restore-journal.js'
import { isRestoreJournalSuccessor } from './restore-journal-successor.js'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
function freeze(value: unknown): void {
	if (value === null || typeof value !== 'object') return
	for (const child of Object.values(value)) freeze(child)
	Object.freeze(value)
}

describe('immutable journal reuse boundaries', () => {
	it.each(['parse', 'create', 'decode'])('reuses an immutable result produced by %s', (mode) => {
		const record =
			mode === 'parse'
				? parseRestoreJournalRecord(structuredClone(wire))
				: mode === 'create'
					? createRestoreJournalRecord(wire.intent)
					: decodeRestoreJournalRecord(bytes(wire))
		expect(parseRestoreJournalRecord(record)).toBe(record)
		expect(parseRestoreJournalRecord(record)).toEqual(wire)
		expect(Object.isFrozen(record.intent.plan.mappings)).toBe(true)
		expect(Object.isFrozen(record.checkpoint)).toBe(true)
	})
	it('revalidates the mutable caller object after its earlier result has been reused', () => {
		const input = structuredClone(wire)
		const record = parseRestoreJournalRecord(input)
		expect(parseRestoreJournalRecord(record)).toBe(record)
		input.intent.operation.operationId = 'another-operation'
		const updated = parseRestoreJournalRecord(input)
		expect(updated.intent.operation.operationId).toBe('another-operation')
		expect(record.intent.operation.operationId).toBe(wire.intent.operation.operationId)
		input.revision = -1
		expect(() => parseRestoreJournalRecord(input)).toThrow('invalidJournal')
		expect(() => encodeRestoreJournalRecord(input)).toThrow('invalidJournal')
	})
	it('revalidates foreign intent input after a successful comparison', () => {
		const record = parseRestoreJournalRecord(wire)
		const expected = structuredClone(wire.intent)
		expect(matchRestoreJournalIntent(record, expected)).toBe(true)
		expected.operation.operationId = 'another-operation'
		expect(matchRestoreJournalIntent(record, expected)).toBe(false)
		expected.plan.sha256 = 'invalid'
		expect(() => matchRestoreJournalIntent(record, expected)).toThrow('invalidJournal')
	})
	it('detaches caller-frozen copies and rejects frozen invalid checkpoints', () => {
		const record = parseRestoreJournalRecord(wire)
		const foreign = structuredClone(record)
		freeze(foreign)
		const checked = parseRestoreJournalRecord(foreign)
		expect(checked).toEqual(record)
		expect(checked).not.toBe(foreign)
		expect(checked).not.toBe(record)
		expect(parseRestoreJournalRecord(foreign)).not.toBe(checked)
		const invalid = { ...record, revision: -1 }
		freeze(invalid)
		expect(() => parseRestoreJournalRecord(invalid)).toThrow('invalidJournal')
		expect(() => encodeRestoreJournalRecord(invalid)).toThrow('invalidJournal')
	})
	it('does not treat a proxy around a known frozen record as that record', () => {
		const record = parseRestoreJournalRecord(wire)
		const { proxy, revoke } = Proxy.revocable(record, {})
		const checked = parseRestoreJournalRecord(proxy)
		expect(checked).toEqual(record)
		expect(checked).not.toBe(record)
		revoke()
		expect(() => parseRestoreJournalRecord(proxy)).toThrow('invalidJournal')
		expect(parseRestoreJournalRecord(checked)).toBe(checked)
	})
	it('does not retain trust in a foreign intent proxy after revocation', () => {
		const record = parseRestoreJournalRecord(wire)
		const { proxy, revoke } = Proxy.revocable(record.intent, {})
		expect(matchRestoreJournalIntent(record, proxy)).toBe(true)
		revoke()
		expect(() => matchRestoreJournalIntent(record, proxy)).toThrow('invalidJournal')
	})
	it('returns independent encoded buffers and preserves later encodes after clearing a result', () => {
		const record = parseRestoreJournalRecord(wire)
		const first = encodeRestoreJournalRecord(record)
		const expected = first.slice()
		const second = encodeRestoreJournalRecord(record)
		expect(first.buffer).not.toBe(second.buffer)
		first.fill(0)
		expect(second).toEqual(expected)
		expect(encodeRestoreJournalRecord(record)).toEqual(expected)
		expect(parseRestoreJournalRecord(record)).toEqual(wire)
	})
	it('decodes fresh bytes even when their array identity has already been used', () => {
		const input = bytes(wire)
		const record = decodeRestoreJournalRecord(input)
		const again = decodeRestoreJournalRecord(input)
		expect(again).toEqual(record)
		expect(again).not.toBe(record)
		const changed = bytes({ ...wire, version: 2 })
		expect(changed.byteLength).toBe(input.byteLength)
		input.set(changed)
		expect(() => decodeRestoreJournalRecord(input)).toThrow('unsupportedJournalVersion')
		expect(decodeRestoreJournalRecord(encodeRestoreJournalRecord(record))).toEqual(wire)
	})
	it('compares full mapping values even when declared plan and graph hashes match', () => {
		const record = parseRestoreJournalRecord(wire)
		const input = structuredClone(wire)
		const mapping = input.intent.plan.mappings[1]
		if (!mapping) throw new Error('Fixture mapping missing')
		mapping.sourceId = 'changed-source'
		const changed = parseRestoreJournalRecord(input)
		expect(changed.intent.plan.sha256).toBe(record.intent.plan.sha256)
		expect(matchRestoreJournalIntent(record, changed.intent)).toBe(false)
		const reopened = decodeRestoreJournalRecord(encodeRestoreJournalRecord(record))
		expect(matchRestoreJournalIntent(record, reopened.intent)).toBe(true)
		expect(reopened).toEqual(record)
	})
	it('compares changed receipts and preserves successor and uncertainty rules', () => {
		const initial = parseRestoreJournalRecord(wire)
		const pending = parseRestoreJournalRecord({
			...initial,
			revision: 1,
			checkpoint: {
				kind: 'writing',
				completed: [],
				current: {
					status: 'issued',
					writeId: 'prepare',
					issuance: 1,
					transactionId: null,
					settlement: { local: 'unobserved', remote: 'unobserved' }
				}
			}
		})
		expect(isRestoreJournalSuccessor(initial, pending)).toBe(true)
		expect(isRestoreJournalSuccessor(pending, pending)).toBe(false)
		expect(isRestoreJournalSuccessor(pending, { ...initial, revision: 2 })).toBe(false)
	})
	it('rejects non-JSON normalized output when a proxy differs from its preflight descriptors', () => {
		const input = new Proxy(structuredClone(wire), {
			get(target, key, receiver): unknown {
				if (key === 'revision') return 1
				if (key === 'checkpoint')
					return {
						kind: 'writing',
						completed: [],
						current: {
							status: 'issued',
							writeId: 'prepare',
							issuance: 1,
							transactionId: null,
							settlement: { local: 'unobserved', remote: 'unobserved' },
							lastRejectedAttempt: undefined
						}
					}
				return Reflect.get(target, key, receiver)
			}
		})
		expect(() => parseRestoreJournalRecord(input)).toThrow('invalidJournal')
		expect(() => encodeRestoreJournalRecord(input)).toThrow('invalidJournal')
	})
})
