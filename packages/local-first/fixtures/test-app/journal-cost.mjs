// Opt-in synthetic codec diagnostic. No app login, real workspace or journal contents are logged.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import {
	createRestoreJournalRecord,
	encodeRestoreJournalRecord,
	decodeRestoreJournalRecord,
	parseRestoreJournalRecord
} from 'delightful-local-first/backup/restore/journal'

const wire = JSON.parse(
	await readFile(new URL('../../tests/fixtures/restore-journal-v1.json', import.meta.url), 'utf8')
)
const label = process.env.DLF_JOURNAL_COST_LABEL ?? 'before'
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid measurement label')
const results = []
for (const count of [32, 128, 633]) {
	const mappings = Array.from({ length: count }, (_, i) => ({
		kind: 'record',
		type: 'note',
		sourceId: `source-${i}`,
		destinationId: `destination-${i}`
	}))
	const batches = mappings.map((_, i) => ({
		writeId: `batch-${i}`,
		expectedContentSha256: '5'.repeat(64),
		mappingIndexes: [i]
	}))
	const intent = {
		...wire.intent,
		plan: {
			...wire.intent.plan,
			mappings,
			preparation: { ...wire.intent.plan.preparation, mappingIndexes: [] },
			batches
		}
	}
	const record = createRestoreJournalRecord(intent)
	const bytes = encodeRestoreJournalRecord(record)
	for (const operation of ['create', 'foreignParse', 'decode', 'knownEncode']) {
		const run = () =>
			operation === 'create'
				? createRestoreJournalRecord(record.intent)
				: operation === 'foreignParse'
					? parseRestoreJournalRecord(structuredClone(record))
					: operation === 'decode'
						? decodeRestoreJournalRecord(bytes)
						: encodeRestoreJournalRecord(record)
		for (let i = 0; i < 3; i++) run()
		let encodes = 0,
			encodedBytes = 0
		const original = TextEncoder.prototype.encode
		TextEncoder.prototype.encode = function (input) {
			const result = original.call(this, input)
			encodes++
			encodedBytes += result.byteLength
			return result
		}
		const started = performance.now()
		try {
			for (let i = 0; i < 20; i++) run()
		} finally {
			TextEncoder.prototype.encode = original
		}
		results.push({
			count,
			operation,
			iterations: 20,
			elapsedMs: performance.now() - started,
			encodes,
			encodedBytes,
			wireBytes: bytes.byteLength
		})
	}
}
await mkdir('.svelte-kit/restore-review', { recursive: true })
await writeFile(
	`.svelte-kit/restore-review/journal-cost-${label}.json`,
	JSON.stringify(results, null, 2) + '\n',
	{ flag: 'wx' }
)
console.log(JSON.stringify(results, null, 2))
