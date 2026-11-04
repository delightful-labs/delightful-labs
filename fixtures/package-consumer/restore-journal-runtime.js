// Exercise the built package without an application session or a consumer-provided Zod schema.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	createRestoreJournalRecord,
	decodeRestoreJournalRecord,
	encodeRestoreJournalRecord,
	matchRestoreJournalIntent,
	parseRestoreJournalRecord,
	isRestoreJournalError
} from 'delightful-local-first/backup/restore/journal'

const wire = readFileSync(new URL('../../tests/fixtures/restore-journal-v1.json', import.meta.url))
const before = Buffer.from(wire)
const record = decodeRestoreJournalRecord(wire)
assert.deepEqual(createRestoreJournalRecord(record.intent), record)
assert.deepEqual(decodeRestoreJournalRecord(encodeRestoreJournalRecord(record)), record)
assert.ok(matchRestoreJournalIntent(record, record.intent))
assert.ok(
	!matchRestoreJournalIntent(record, {
		...record.intent,
		operation: { ...record.intent.operation, identityId: 'another-owner' }
	})
)
assert.deepEqual(wire, before)
assert.ok(Object.isFrozen(record.intent.plan.mappings))

const pending = parseRestoreJournalRecord({
	...record,
	revision: 1,
	checkpoint: {
		kind: 'writing',
		completed: [],
		current: {
			status: 'issued',
			writeId: record.intent.plan.preparation.writeId,
			issuance: 1,
			settlement: { local: 'persisted', remote: 'unobserved' },
			transactionId: null
		}
	}
})
assert.deepEqual(decodeRestoreJournalRecord(encodeRestoreJournalRecord(pending)), pending)
assert.equal(pending.checkpoint.kind, 'writing')
assert.throws(
	() => parseRestoreJournalRecord({ ...record, version: 2 }),
	(error) => isRestoreJournalError(error) && error.code === 'unsupportedJournalVersion'
)
assert.throws(
	() => decodeRestoreJournalRecord(new TextEncoder().encode('{"version":1,"version":1}')),
	(error) => isRestoreJournalError(error) && error.code === 'invalidJournalEncoding'
)
