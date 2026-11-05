import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import {
	encodeArchivePayload,
	parseArchivePayload,
	type ArchivePayload,
	type ArchiveRecord
} from 'delightful-local-first/backup/archive'
import { createNotebookDataset } from './dataset.js'
import {
	projectNotebookGraph,
	notebookNoteBatchLimits,
	type NotebookRestorePlanData
} from './restore-plan.js'

function dataFor(payload: ArchivePayload): NotebookRestorePlanData {
	return {
		archive: {
			readPayload: () => payload,
			payloadDigest: () => '1'.repeat(64),
			copyPayloadBytes: () => encodeArchivePayload(payload),
			release() {},
			toJSON: () => ({ kind: 'integrityCheckedArchive' })
		},
		binding: {
			applicationId: 'notebook',
			environment: 'test',
			identityId: 'owner',
			workspaceId: 'destination',
			operationId: 'operation',
			generation: 1
		},
		mappings: [
			...payload.records.map(
				(r, i) =>
					({
						kind: 'record',
						type: r.type,
						sourceId: r.id,
						destinationId: `destination-record-${i}`
					}) satisfies NotebookRestorePlanData['mappings'][number]
			),
			...payload.attachments.map(
				(r, i) =>
					({
						kind: 'attachment',
						sourceId: r.id,
						destinationId: `destination-file-${i}`
					}) satisfies NotebookRestorePlanData['mappings'][number]
			)
		],
		graph: '',
		graphSha256: '',
		preparation: '',
		preparationSha256: '',
		batches: [],
		activation: '',
		activationSha256: ''
	}
}
function synthetic(notes: number, body: string): ArchivePayload {
	const raw = createNotebookDataset({ applicationId: 'notebook', workspaceId: 'original' })
	const root = raw.records.find((r) => r.type === 'notebook')
	if (!root) throw new Error('Missing root')
	const rows = Array.from({ length: notes }, (_, i): ArchiveRecord => ({
		type: 'note',
		id: `note-${i}`,
		fields: {
			notebook: { kind: 'reference', type: 'notebook', id: root.id },
			body: { kind: 'text', value: body },
			archived: { kind: 'boolean', value: i % 2 === 0 },
			attachment: { kind: 'null' }
		}
	}))
	return parseArchivePayload(
		encodeArchivePayload({ ...raw, records: [root, ...rows], attachments: [] })
	)
}
it('preserves the fast plan graph and batch bytes exactly', () => {
	const payload = parseArchivePayload(
		encodeArchivePayload(
			createNotebookDataset({ applicationId: 'notebook', workspaceId: 'original' })
		)
	)
	const data = dataFor(payload)
	projectNotebookGraph(data)
	const expected: unknown = JSON.parse(
		readFileSync(new URL('../../tests/fixtures/notebook-plan-v2.json', import.meta.url), 'utf8')
	)
	expect({
		graph: data.graph,
		batches: data.batches.map(({ mappingIndexes, contents }) => ({ mappingIndexes, contents }))
	}).toEqual(expected)
})
it('groups notes within count bounds, after the root, assigning every mapping exactly once', () => {
	const data = dataFor(synthetic(65, 'café ☕\n'))
	projectNotebookGraph(data)
	expect(data.batches.map((b) => b.mappingIndexes.length)).toEqual([1, 32, 32, 1])
	expect(
		data.batches[0]?.mappingIndexes.map(
			(i) => data.mappings[i]?.kind === 'record' && data.mappings[i]?.type
		)
	).toEqual(['notebook'])
	const indexes = data.batches.flatMap((b) => b.mappingIndexes)
	expect(new Set(indexes).size).toBe(data.mappings.length)
	expect(indexes.length).toBe(data.mappings.length)
})
it.each(['x'.repeat(35000), '😀'.repeat(17000)])(
	'uses UTF-8 byte bounds and permits a large valid singleton',
	(body) => {
		const data = dataFor(synthetic(3, body))
		projectNotebookGraph(data)
		expect(data.batches.map((b) => b.mappingIndexes.length)).toEqual([1, 1, 1, 1])
		for (const batch of data.batches.slice(1)) expect(JSON.parse(batch.contents)).toHaveLength(1)
	}
)
it('checks both the count and canonical byte size at the boundary', () => {
	const data = dataFor(synthetic(64, '界'.repeat(1000)))
	projectNotebookGraph(data)
	for (const batch of data.batches.slice(1)) {
		expect(batch.mappingIndexes.length).toBeLessThanOrEqual(notebookNoteBatchLimits.records)
		expect(new TextEncoder().encode(batch.contents).byteLength).toBeLessThanOrEqual(
			notebookNoteBatchLimits.bytes
		)
	}
})
it('accepts the fast retained plan and rejects incompatible plans before projection', () => {
	const payload = synthetic(40, 'body')
	const data = dataFor(payload)
	projectNotebookGraph(data)
	const retained = {
		id: 'dlf-notebook',
		version: 2,
		sha256: '1'.repeat(64),
		expectedGraphSha256: '2'.repeat(64),
		mappings: data.mappings,
		preparation: { writeId: 'prepare', expectedContentSha256: '3'.repeat(64), mappingIndexes: [] },
		batches: [],
		activation: { writeId: 'activate', expectedContentSha256: '4'.repeat(64) },
		requirements: { local: 'required', remote: 'required' }
	} satisfies Parameters<typeof projectNotebookGraph>[1]
	const resumed = dataFor(payload)
	projectNotebookGraph(resumed, retained)
	expect(resumed.batches).toEqual(data.batches)
	for (const version of [1, 3]) {
		const incompatible = dataFor(payload)
		expect(() => projectNotebookGraph(incompatible, { ...retained, version })).toThrow(
			'Unsupported notebook restore plan'
		)
		expect(incompatible.batches).toEqual([])
		expect(incompatible.graph).toBe('')
	}
})
