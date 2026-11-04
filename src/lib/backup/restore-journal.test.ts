import { describe, expect, it, vi } from 'vitest'
import wire from '../../../tests/fixtures/restore-journal-v1.json'
import {
	createRestoreJournalRecord,
	decodeRestoreJournalRecord,
	encodeRestoreJournalRecord,
	matchRestoreJournalIntent,
	parseRestoreJournalRecord,
	restoreJournalLimits,
	isRestoreJournalError,
	type RestoreJournalCheckpoint,
	type RestoreJournalReceipt
} from './restore-journal.js'

const utf8 = new TextEncoder()
const bytes = (value: unknown) => utf8.encode(JSON.stringify(value))
function sample() {
	return structuredClone(wire)
}
function receipt(
	writeId: string,
	settlement: RestoreJournalReceipt['settlement'] = { local: 'persisted', remote: 'accepted' }
): RestoreJournalReceipt {
	return { writeId, issuance: 1, settlement, transactionId: null }
}
function completed() {
	return [receipt('prepare'), receipt('batch-notes')]
}
const comparison = { payloadSha256: '1'.repeat(64), graphSha256: '3'.repeat(64) }
function checkpoint(value: RestoreJournalCheckpoint, revision = 6) {
	return { ...sample(), revision, checkpoint: value }
}
function assertFrozen(value: unknown) {
	if (value === null || typeof value !== 'object') return
	expect(Object.isFrozen(value)).toBe(true)
	for (const item of Object.values(value)) assertFrozen(item)
}

describe('journal wire and immutable public model', () => {
	it('reads an independently authored v1 wire record and creates the exact initial intent', () => {
		const decoded = decodeRestoreJournalRecord(bytes(wire))
		expect(decoded).toEqual(wire)
		expect(createRestoreJournalRecord(wire.intent)).toEqual(wire)
		expect(decoded.checkpoint).toEqual({
			kind: 'writing',
			completed: [],
			current: { status: 'notIssued', writeId: 'prepare', issuance: 0 }
		})
		expect(matchRestoreJournalIntent(decoded, wire.intent)).toBe(true)
		assertFrozen(decoded)
	})
	it('detaches/freezes every nested result and does not mutate borrowed input bytes', () => {
		const input = sample(),
			parsed = parseRestoreJournalRecord(input)
		Object.assign(input.intent.plan.mappings[0] ?? {}, { sourceId: 'mutated' })
		expect(parsed).toEqual(wire)
		assertFrozen(parsed)
		const encoded = encodeRestoreJournalRecord(parsed),
			borrowed = Buffer.from(encoded),
			before = borrowed.slice()
		expect(decodeRestoreJournalRecord(borrowed)).toEqual(parsed)
		expect(borrowed).toEqual(before)
		encoded.fill(0)
		expect(parsed).toEqual(wire)
	})
	it('normalizes schema key order for equality while keeping exact Unicode and whitespace', () => {
		const input = sample()
		input.intent.operation.operationId = ' \nCafe\u0301 😀\u0000 '
		const record = createRestoreJournalRecord(input.intent)
		const reversed = {
			plan: input.intent.plan,
			archive: input.intent.archive,
			operation: input.intent.operation
		}
		expect(matchRestoreJournalIntent(record, reversed)).toBe(true)
		expect(
			decodeRestoreJournalRecord(encodeRestoreJournalRecord(record)).intent.operation.operationId
		).toBe(input.intent.operation.operationId)
		expect(
			matchRestoreJournalIntent(record, {
				...input.intent,
				operation: { ...input.intent.operation, operationId: ' \nCafé 😀\u0000 ' }
			})
		).toBe(false)
	})
	it.each([2, 999])(
		'rejects unsupported version %s without changing or repairing the record',
		(version) => {
			const input = { ...sample(), version },
				before = structuredClone(input)
			expect(() => parseRestoreJournalRecord(input)).toThrow('unsupportedJournalVersion')
			expect(() => decodeRestoreJournalRecord(bytes(input))).toThrow('unsupportedJournalVersion')
			expect(input).toEqual(before)
		}
	)
	it.each([
		null,
		[],
		{},
		{ ...wire, version: 0 },
		{ ...wire, version: '1' },
		{ ...wire, revision: -0 },
		{ ...wire, format: 'foreign' },
		{ ...wire, secret: 'private-recovery-sentinel' }
	])('rejects malformed metadata with safe errors: %j', (input) => {
		let error: unknown
		try {
			parseRestoreJournalRecord(input)
		} catch (caught) {
			error = caught
		}
		expect(isRestoreJournalError(error)).toBe(true)
		expect(error).toMatchObject({ code: 'invalidJournal', message: 'invalidJournal' })
		expect(JSON.stringify(error)).not.toContain('private-recovery-sentinel')
	})
	it.each(['0.0', '0e0', '-0', '9007199254740992', '1.00000000000000001'])(
		'rejects noncanonical/unsafe numeric revision token %s before rounding',
		(token) => {
			const text = JSON.stringify(wire).replace('"revision":0', `"revision":${token}`)
			expect(() => decodeRestoreJournalRecord(utf8.encode(text))).toThrow('invalidJournalEncoding')
		}
	)
	it.each(['1.00000000000000001', '1e0', '1.0'])(
		'rejects counterfeit version token %s before numeric conversion',
		(token) => {
			const text = JSON.stringify(wire).replace('"version":1', `"version":${token}`)
			expect(() => decodeRestoreJournalRecord(utf8.encode(text))).toThrow('invalidJournalEncoding')
		}
	)
	it.each([
		JSON.stringify(wire).replace('"revision":0', '"revision":0,"revisi\\u006fn":1'),
		JSON.stringify(wire) + ' null',
		JSON.stringify(wire).slice(0, -1),
		'\ufeff' + JSON.stringify(wire),
		''
	])('rejects duplicate, trailing, truncated, BOM or empty JSON', (text) => {
		expect(() => decodeRestoreJournalRecord(utf8.encode(text))).toThrow('invalidJournalEncoding')
	})
	it('rejects invalid UTF-8 without replacing bytes', () => {
		expect(() => decodeRestoreJournalRecord(new Uint8Array([0xff]))).toThrow(
			'invalidJournalEncoding'
		)
	})
})

describe('bounded unknown metadata', () => {
	it('rejects accessor input before running user code or schema cloning', () => {
		const get = vi.fn(() => wire.intent)
		const input = { ...sample() }
		Object.defineProperty(input, 'intent', { enumerable: true, get })
		expect(() => parseRestoreJournalRecord(input)).toThrow('invalidJournal')
		expect(get).not.toHaveBeenCalled()
	})
	it.each(['sparse', 'prototype', 'toJSON', 'symbol'])(
		'rejects unsupported %s object data without coercion',
		(kind) => {
			const input = sample()
			const sparse: unknown[] = [null, null, null]
			delete sparse[1]
			let bad: unknown = sparse
			if (kind === 'prototype') bad = new Date()
			const toJSON = vi.fn(() => {
				throw new Error('private callback')
			})
			if (kind === 'toJSON') bad = { toJSON }
			if (kind === 'symbol') bad = { [Symbol('private')]: true }
			expect(() => parseRestoreJournalRecord({ ...input, intent: bad })).toThrow('invalidJournal')
			expect(toJSON).not.toHaveBeenCalled()
		}
	)
	it('bounds incoming bytes, array overhead and depth before schema processing', () => {
		expect(() =>
			decodeRestoreJournalRecord(new Uint8Array(restoreJournalLimits.bytes + 1))
		).toThrow('journalLimitExceeded')
		expect(() =>
			parseRestoreJournalRecord({
				values: Array.from({ length: restoreJournalLimits.jsonValues + 1 }, () => null)
			})
		).toThrow('journalLimitExceeded')
		let nested: unknown = null
		for (let depth = 0; depth <= restoreJournalLimits.depth; depth += 1) nested = { nested }
		expect(() => parseRestoreJournalRecord(nested)).toThrow('journalLimitExceeded')
	})
	it('enforces wire bytes including JSON syntax after object-budget checks', () => {
		const input = sample(),
			total = 15_000
		const mappings = Array.from({ length: total }, (_, index) => ({
			kind: 'record',
			type: 'row',
			sourceId: `source-${index}-`.padEnd(256, 's'),
			destinationId: `target-${index}-`.padEnd(256, 'd')
		}))
		const value = {
			...input,
			intent: {
				...input.intent,
				plan: {
					...input.intent.plan,
					mappings,
					preparation: {
						...input.intent.plan.preparation,
						mappingIndexes: Array.from({ length: total }, (_, index) => index)
					},
					batches: []
				}
			}
		}
		expect(bytes(value).byteLength).toBeGreaterThan(restoreJournalLimits.bytes)
		expect(() => parseRestoreJournalRecord(value)).toThrow('journalLimitExceeded')
	})
	it.each(['tooManyBytes', 'badSurrogate', 'empty', 'wrongHash'])(
		'rejects %s identifier/hash data',
		(kind) => {
			const input = sample()
			if (kind === 'wrongHash') input.intent.archive.payloadSha256 = 'A'.repeat(64)
			else
				input.intent.operation.operationId =
					kind === 'tooManyBytes' ? 'é'.repeat(129) : kind === 'badSurrogate' ? '\ud800' : ''
			expect(() => createRestoreJournalRecord(input.intent)).toThrow('invalidJournal')
		}
	)
	it('accepts the exact UTF-8 identifier boundary', () => {
		const input = sample()
		input.intent.operation.operationId = 'é'.repeat(128)
		expect(createRestoreJournalRecord(input.intent).intent.operation.operationId).toBe(
			input.intent.operation.operationId
		)
	})
})

describe('mapping and plan closure', () => {
	it.each([
		'duplicateSource',
		'recordReferenceCollision',
		'duplicateFile',
		'duplicateDestination',
		'sourceDestinationCollision',
		'crossSourceDestinationCollision',
		'sourceWorkspaceDestination',
		'sourceRecordWorkspace',
		'unassigned',
		'duplicateIndex',
		'crossGroupIndex',
		'outOfRangeIndex',
		'fractionalIndex',
		'negativeZeroIndex',
		'emptyBatch',
		'duplicateWrite',
		'activationWriteCollision'
	])('rejects %s without changing mappings or generating replacement IDs', (kind) => {
		const value = sample(),
			plan = value.intent.plan
		if (kind === 'duplicateSource')
			Object.assign(plan.mappings[1] ?? {}, { type: 'notebook', sourceId: 'book' })
		if (kind === 'recordReferenceCollision')
			Object.assign(plan.mappings[1] ?? {}, {
				kind: 'reference',
				type: 'notebook',
				sourceId: 'book'
			})
		if (kind === 'duplicateFile')
			plan.mappings[1] = { kind: 'attachment', sourceId: 'binary', destinationId: 'another-file' }
		if (kind === 'duplicateDestination')
			Object.assign(plan.mappings[1] ?? {}, { destinationId: 'destination-file' })
		if (kind === 'sourceDestinationCollision')
			Object.assign(plan.mappings[1] ?? {}, { destinationId: 'note-one' })
		if (kind === 'crossSourceDestinationCollision')
			Object.assign(plan.mappings[1] ?? {}, { destinationId: 'binary' })
		if (kind === 'sourceWorkspaceDestination')
			value.intent.operation.destinationWorkspaceId = 'source-workspace'
		if (kind === 'sourceRecordWorkspace') value.intent.operation.destinationWorkspaceId = 'note-one'
		if (kind === 'unassigned') plan.batches[0]?.mappingIndexes.pop()
		if (kind === 'duplicateIndex') plan.preparation.mappingIndexes.push(0)
		if (kind === 'crossGroupIndex') plan.preparation.mappingIndexes.push(1)
		if (kind === 'outOfRangeIndex') plan.preparation.mappingIndexes.push(3)
		if (kind === 'fractionalIndex') plan.preparation.mappingIndexes.push(0.5)
		if (kind === 'negativeZeroIndex') plan.preparation.mappingIndexes[0] = -0
		if (kind === 'emptyBatch') Object.assign(plan.batches[0] ?? {}, { mappingIndexes: [] })
		if (kind === 'duplicateWrite') Object.assign(plan.batches[0] ?? {}, { writeId: 'prepare' })
		if (kind === 'activationWriteCollision') plan.activation.writeId = 'prepare'
		const before = structuredClone(value)
		expect(() => parseRestoreJournalRecord(value)).toThrow('invalidJournal')
		expect(value).toEqual(before)
	})
	it('keeps source namespaces and tuples distinct without delimiter concatenation', () => {
		const input = sample()
		const mappings = [
			{ kind: 'record', type: 'a:b', sourceId: 'c', destinationId: 'one' },
			{ kind: 'reference', type: 'a', sourceId: 'b:c', destinationId: 'two' },
			{ kind: 'attachment', sourceId: 'c', destinationId: 'three' }
		]
		const candidate = { ...input.intent, plan: { ...input.intent.plan, mappings } }
		expect(createRestoreJournalRecord(candidate).intent.plan.mappings).toEqual(mappings)
	})
	it.each(['record', 'attachment'])(
		'enforces the %s mapping sublimit as well as total byte/value bounds',
		(kind) => {
			const input = sample(),
				total =
					kind === 'record'
						? restoreJournalLimits.recordMappings + 1
						: restoreJournalLimits.attachmentMappings + 1
			const mappings = Array.from({ length: total }, (_, index) =>
				kind === 'record'
					? {
							kind,
							type: 'row',
							sourceId: `source-${index}`,
							destinationId: `destination-${index}`
						}
					: { kind, sourceId: `source-${index}`, destinationId: `destination-${index}` }
			)
			const candidate = {
				...input.intent,
				plan: {
					...input.intent.plan,
					mappings,
					preparation: {
						...input.intent.plan.preparation,
						mappingIndexes: mappings.map((_, index) => index)
					},
					batches: []
				}
			}
			expect(() => createRestoreJournalRecord(candidate)).toThrow('invalidJournal')
		}
	)
	it('accepts no-data plans and preparation-owned atomic groups', () => {
		const input = sample()
		const empty = {
			...input.intent,
			plan: {
				...input.intent.plan,
				mappings: [],
				preparation: { ...input.intent.plan.preparation, mappingIndexes: [] },
				batches: []
			}
		}
		expect(createRestoreJournalRecord(empty).intent.plan.mappings).toEqual([])
		const atomic = {
			...input.intent,
			plan: {
				...input.intent.plan,
				preparation: { ...input.intent.plan.preparation, mappingIndexes: [0, 1, 2] },
				batches: []
			}
		}
		expect(createRestoreJournalRecord(atomic).intent.plan.preparation.mappingIndexes).toEqual([
			0, 1, 2
		])
	})
})

describe('unknown writes and settlement checkpoints', () => {
	it.each(['unobserved', 'persisted'])(
		'retains local %s separately from unknown remote acceptance',
		(local) => {
			const settlement: RestoreJournalReceipt['settlement'] = {
				local: local === 'persisted' ? 'persisted' : 'unobserved',
				remote: 'unobserved'
			}
			const input = checkpoint(
				{
					kind: 'writing',
					completed: [],
					current: { status: 'issued', ...receipt('prepare', settlement) }
				},
				1
			)
			expect(decodeRestoreJournalRecord(encodeRestoreJournalRecord(input))).toEqual(input)
			expect(input.checkpoint.kind).toBe('writing')
		}
	)
	it('retains rejected current writes and the exact conflict checkpoint without converting either to absence', () => {
		const pending: RestoreJournalCheckpoint = {
			kind: 'writing',
			completed: [],
			current: {
				status: 'issued',
				...receipt('prepare', { local: 'persisted', remote: 'rejected' })
			}
		}
		const value = checkpoint({ kind: 'conflict', reason: 'contentMismatch', prior: pending })
		expect(decodeRestoreJournalRecord(encodeRestoreJournalRecord(value))).toEqual(value)
	})
	it('keeps a reissuance counter with the same stable write and mapping identity', () => {
		const value = checkpoint({
			kind: 'writing',
			completed: [],
			current: { status: 'notIssued', writeId: 'prepare', issuance: 2 }
		})
		expect(parseRestoreJournalRecord(value)).toEqual(value)
		expect(matchRestoreJournalIntent(value, wire.intent)).toBe(true)
	})
	it.each([
		'unknownRemote',
		'unknownLocal',
		'localRejection',
		'remoteRejection',
		'wrongPrefix',
		'duplicateReceipt',
		'tooManyReceipts',
		'wrongCurrent',
		'issuedZero',
		'initialIssued',
		'initialProgress',
		'residualSettlement'
	])('rejects %s as a completed or correlated checkpoint', (kind) => {
		let value: unknown = checkpoint({ kind: 'comparing', completed: completed() })
		if (kind === 'unknownRemote')
			value = checkpoint({
				kind: 'comparing',
				completed: [
					receipt('prepare', { local: 'persisted', remote: 'unobserved' }),
					receipt('batch-notes')
				]
			})
		if (kind === 'unknownLocal')
			value = checkpoint({
				kind: 'comparing',
				completed: [
					receipt('prepare', { local: 'unobserved', remote: 'accepted' }),
					receipt('batch-notes')
				]
			})
		if (kind === 'localRejection')
			value = checkpoint({
				kind: 'comparing',
				completed: [
					receipt('prepare', { local: 'rejected', remote: 'accepted' }),
					receipt('batch-notes')
				]
			})
		if (kind === 'remoteRejection')
			value = checkpoint({
				kind: 'comparing',
				completed: [
					receipt('prepare', { local: 'persisted', remote: 'rejected' }),
					receipt('batch-notes')
				]
			})
		if (kind === 'wrongPrefix')
			value = checkpoint({
				kind: 'writing',
				completed: [receipt('batch-notes')],
				current: { status: 'notIssued', writeId: 'batch-notes', issuance: 0 }
			})
		if (kind === 'duplicateReceipt')
			value = checkpoint({ kind: 'comparing', completed: [receipt('prepare'), receipt('prepare')] })
		if (kind === 'tooManyReceipts')
			value = checkpoint({ kind: 'comparing', completed: [...completed(), receipt('activate')] })
		if (kind === 'wrongCurrent')
			value = checkpoint({
				kind: 'writing',
				completed: [receipt('prepare')],
				current: { status: 'notIssued', writeId: 'prepare', issuance: 0 }
			})
		if (kind === 'issuedZero')
			value = {
				...checkpoint({
					kind: 'writing',
					completed: [],
					current: { status: 'issued', ...receipt('prepare') }
				}),
				checkpoint: {
					kind: 'writing',
					completed: [],
					current: { status: 'issued', ...receipt('prepare'), issuance: 0 }
				}
			}
		if (kind === 'initialIssued')
			value = checkpoint(
				{ kind: 'writing', completed: [], current: { status: 'issued', ...receipt('prepare') } },
				0
			)
		if (kind === 'initialProgress')
			value = checkpoint({ kind: 'comparing', completed: completed() }, 0)
		if (kind === 'residualSettlement')
			value = {
				...sample(),
				checkpoint: {
					...wire.checkpoint,
					current: {
						...wire.checkpoint.current,
						settlement: { local: 'persisted', remote: 'accepted' }
					}
				}
			}
		expect(() => parseRestoreJournalRecord(value)).toThrow('invalidJournal')
	})
	it('requires all preparation/batch receipts before comparison or activation', () => {
		expect(
			parseRestoreJournalRecord(checkpoint({ kind: 'comparing', completed: completed() }))
				.checkpoint.kind
		).toBe('comparing')
		for (const kind of ['comparing', 'activating']) {
			const progress = {
				kind,
				completed: [receipt('prepare')],
				...(kind === 'activating'
					? { comparison, current: { status: 'notIssued', writeId: 'activate', issuance: 0 } }
					: {})
			}
			expect(() =>
				parseRestoreJournalRecord({ ...sample(), revision: 5, checkpoint: progress })
			).toThrow('invalidJournal')
		}
	})
	it.each(['payload', 'graph', 'writeId', 'unknownActivation', 'rejectedActivation'])(
		'rejects %s mismatch before verified completion',
		(kind) => {
			const progress = {
				kind: 'complete',
				completed: completed(),
				comparison: {
					payloadSha256: kind === 'payload' ? '9'.repeat(64) : comparison.payloadSha256,
					graphSha256: kind === 'graph' ? '9'.repeat(64) : comparison.graphSha256
				},
				activation: receipt(kind === 'writeId' ? 'foreign' : 'activate', {
					local: 'persisted',
					remote:
						kind === 'unknownActivation'
							? 'unobserved'
							: kind === 'rejectedActivation'
								? 'rejected'
								: 'accepted'
				})
			}
			expect(() =>
				parseRestoreJournalRecord({ ...sample(), revision: 8, checkpoint: progress })
			).toThrow('invalidJournal')
		}
	)
	it('validates separately issued activation, completion and a preserved post-completion conflict', () => {
		const activating = checkpoint({
			kind: 'activating',
			completed: completed(),
			comparison,
			current: {
				status: 'issued',
				...receipt('activate', { local: 'unobserved', remote: 'unobserved' })
			}
		})
		expect(parseRestoreJournalRecord(activating)).toEqual(activating)
		const progress: RestoreJournalCheckpoint = {
			kind: 'complete',
			completed: completed(),
			comparison,
			activation: receipt('activate')
		}
		expect(parseRestoreJournalRecord(checkpoint(progress))).toEqual(checkpoint(progress))
		const conflict = checkpoint({
			kind: 'conflict',
			reason: 'destinationMismatch',
			prior: progress
		})
		expect(parseRestoreJournalRecord(conflict)).toEqual(conflict)
		expect(() =>
			parseRestoreJournalRecord({
				...activating,
				checkpoint: {
					...activating.checkpoint,
					current: { status: 'notIssued', writeId: 'foreign', issuance: 0 }
				}
			})
		).toThrow('invalidJournal')
	})
	it.each(['local', 'remote'])(
		'keeps explicitly %s-only settlement honest without upgrading the other lane',
		(required) => {
			const input = sample()
			const local = required === 'local'
			const facts: RestoreJournalReceipt['settlement'] = {
				local: local ? 'persisted' : 'unobserved',
				remote: local ? 'unobserved' : 'accepted'
			}
			const value = {
				...input,
				revision: 8,
				intent: {
					...input.intent,
					plan: {
						...input.intent.plan,
						requirements: {
							local: local ? 'required' : 'notRequired',
							remote: local ? 'notRequired' : 'required'
						}
					}
				},
				checkpoint: {
					kind: 'complete',
					completed: [receipt('prepare', facts), receipt('batch-notes', facts)],
					comparison,
					activation: receipt('activate', facts)
				}
			}
			expect(decodeRestoreJournalRecord(encodeRestoreJournalRecord(value))).toEqual(value)
			expect(() =>
				parseRestoreJournalRecord({
					...value,
					intent: {
						...value.intent,
						plan: {
							...value.intent.plan,
							requirements: { local: 'notRequired', remote: 'notRequired' }
						}
					}
				})
			).toThrow('invalidJournal')
		}
	)
})

describe('full intent correlation', () => {
	it('compares every operation/archive/plan field, not only declared fingerprints', () => {
		const record = createRestoreJournalRecord(wire.intent)
		const originals = [
			wire.intent.operation,
			wire.intent.archive,
			wire.intent.archive.profile,
			wire.intent.archive.source,
			wire.intent.plan,
			wire.intent.plan.preparation,
			...wire.intent.plan.batches,
			wire.intent.plan.activation,
			...wire.intent.plan.mappings
		]
		let checked = 0
		for (let group = 0; group < originals.length; group += 1) {
			const original = originals[group]
			for (const [key, field] of Object.entries(original ?? {})) {
				if (typeof field !== 'string' && typeof field !== 'number') continue
				if (key === 'kind') continue
				const candidate = sample().intent
				const groups = [
					candidate.operation,
					candidate.archive,
					candidate.archive.profile,
					candidate.archive.source,
					candidate.plan,
					candidate.plan.preparation,
					...candidate.plan.batches,
					candidate.plan.activation,
					...candidate.plan.mappings
				]
				const target = groups[group]
				if (!target) throw new Error('Missing intent fixture group')
				let changed: string | number = typeof field === 'number' ? field + 1 : `${field}-changed`
				if (key.toLowerCase().includes('sha256')) changed = '9'.repeat(64)
				if (key === 'archiveId') changed = '22345678-1234-4234-8234-123456789abc'
				Object.assign(target, { [key]: changed })
				expect(matchRestoreJournalIntent(record, candidate), `${group}.${key}`).toBe(false)
				checked += 1
			}
		}
		expect(checked).toBeGreaterThan(20)
		const reordered = sample().intent
		reordered.plan.batches[0]?.mappingIndexes.reverse()
		expect(matchRestoreJournalIntent(record, reordered)).toBe(false)
		const changedPolicy = sample().intent
		changedPolicy.plan.requirements.local = 'notRequired'
		expect(matchRestoreJournalIntent(record, changedPolicy)).toBe(false)
	})
	it('throws for malformed stored or expected metadata instead of treating corruption as ordinary mismatch', () => {
		expect(() => matchRestoreJournalIntent({}, wire.intent)).toThrow('invalidJournal')
		expect(() => matchRestoreJournalIntent(wire, {})).toThrow('invalidJournal')
	})
})

describe('journal successor admission', () => {
	it('admits issuance, observed settlement and advancing to the next planned batch', async () => {
		const { isRestoreJournalSuccessor } = await import('./restore-journal-successor.js')
		const initial = sample()
		const issued = checkpoint(
			{
				kind: 'writing',
				completed: [],
				current: {
					status: 'issued',
					...receipt('prepare', { local: 'unobserved', remote: 'unobserved' })
				}
			},
			1
		)
		const settled = checkpoint(
			{ kind: 'writing', completed: [], current: { status: 'issued', ...receipt('prepare') } },
			2
		)
		const advanced = checkpoint(
			{
				kind: 'writing',
				completed: [receipt('prepare')],
				current: { status: 'notIssued', writeId: 'batch-notes', issuance: 0 }
			},
			3
		)
		expect(isRestoreJournalSuccessor(initial, issued)).toBe(true)
		expect(isRestoreJournalSuccessor(issued, settled)).toBe(true)
		expect(isRestoreJournalSuccessor(settled, advanced)).toBe(true)
	})
	it('rejects stale revisions, changed intent and erased issued-write evidence', async () => {
		const { isRestoreJournalSuccessor } = await import('./restore-journal-successor.js')
		const issued = checkpoint(
			{
				kind: 'writing',
				completed: [],
				current: {
					status: 'issued',
					...receipt('prepare', { local: 'persisted', remote: 'unobserved' })
				}
			},
			1
		)
		expect(isRestoreJournalSuccessor(issued, issued)).toBe(false)
		expect(isRestoreJournalSuccessor(issued, { ...sample(), revision: 2 })).toBe(false)
		expect(
			isRestoreJournalSuccessor(issued, {
				...issued,
				revision: 2,
				intent: {
					...issued.intent,
					operation: { ...issued.intent.operation, operationId: 'different-operation' }
				}
			})
		).toBe(false)
		expect(
			isRestoreJournalSuccessor(
				issued,
				checkpoint(
					{
						kind: 'writing',
						completed: [],
						current: {
							status: 'issued',
							...receipt('prepare', { local: 'unobserved', remote: 'unobserved' })
						}
					},
					2
				)
			)
		).toBe(false)
	})
})
