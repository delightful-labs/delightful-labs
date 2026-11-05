import type { ArchivePayload, ArchiveValue } from 'delightful-local-first/backup/archive'
import type { IntegrityCheckedArchive } from 'delightful-local-first/backup/envelope'
import type { BackupBinding } from 'delightful-local-first/backup/export'
import {
	createRestoreJournalRecord,
	type RestoreJournalIntent
} from 'delightful-local-first/backup/restore/journal'

type Mapping = RestoreJournalIntent['plan']['mappings'][number]
export type NotebookRestorePlanData = {
	archive: IntegrityCheckedArchive
	binding: BackupBinding
	mappings: readonly Mapping[]
	graph: string
	graphSha256: string
	preparation: string
	preparationSha256: string
	batches: { mappingIndexes: readonly number[]; contents: string; sha256: string }[]
	activation: string
	activationSha256: string
}

/** Canonical projection of already validated bounded data, never a decoder for untrusted objects. */
export function notebookCanonical(value: unknown): string {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		typeof value === 'number'
	)
		return JSON.stringify(value)
	if (Array.isArray(value)) return '[' + value.map(notebookCanonical).join(',') + ']'
	if (typeof value !== 'object') throw new Error('Invalid notebook projection')
	return (
		'{' +
		Object.entries(value)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, child]) => JSON.stringify(key) + ':' + notebookCanonical(child))
			.join(',') +
		'}'
	)
}
function sourceKey(mapping: Mapping): string {
	return mapping.kind === 'attachment'
		? JSON.stringify(['attachment', mapping.sourceId])
		: JSON.stringify([mapping.kind, mapping.type, mapping.sourceId])
}
export function allocateNotebookMappings(payload: ArchivePayload): readonly Mapping[] {
	const records: Mapping[] = payload.records.map((record) => ({
		kind: 'record',
		type: record.type,
		sourceId: record.id,
		destinationId: crypto.randomUUID()
	}))
	const attachments: Mapping[] = payload.attachments.map((attachment) => ({
		kind: 'attachment',
		sourceId: attachment.id,
		destinationId: crypto.randomUUID()
	}))
	return [...records, ...attachments]
		.map((mapping) => ({ mapping, key: sourceKey(mapping) }))
		.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
		.map(({ mapping }) => mapping)
}
function mappedId(
	ids: ReadonlyMap<string, string>,
	expected:
		| { kind: 'record'; type: string; sourceId: string }
		| { kind: 'attachment'; sourceId: string }
): string {
	const id = ids.get(sourceKey({ ...expected, destinationId: '' }))
	if (!id) throw new Error('Missing notebook mapping')
	return id
}
function remapValue(value: ArchiveValue, ids: ReadonlyMap<string, string>): ArchiveValue {
	if (value.kind === 'reference')
		return {
			...value,
			id: mappedId(ids, { kind: 'record', type: value.type, sourceId: value.id })
		}
	if (value.kind === 'attachment')
		return { ...value, id: mappedId(ids, { kind: 'attachment', sourceId: value.id }) }
	return value
}
export function projectNotebookRecords(data: NotebookRestorePlanData) {
	const ids = new Map(data.mappings.map((mapping) => [sourceKey(mapping), mapping.destinationId]))
	return data.archive.readPayload().records.map((record) => ({
		type: record.type,
		id: mappedId(ids, { kind: 'record', type: record.type, sourceId: record.id }),
		fields: Object.fromEntries(
			Object.entries(record.fields).map(([key, value]) => [key, remapValue(value, ids)])
		)
	}))
}
export const notebookNoteBatchLimits = Object.freeze({ records: 32, bytes: 64 * 1024 })
export function projectNotebookGraph(
	data: NotebookRestorePlanData,
	retained?: RestoreJournalIntent['plan']
): void {
	if (retained && (retained.id !== 'dlf-notebook' || retained.version !== 2))
		throw new Error('Unsupported notebook restore plan')
	const payload = data.archive.readPayload()
	const records = projectNotebookRecords(data)
	const ids = new Map(data.mappings.map((mapping) => [sourceKey(mapping), mapping.destinationId]))
	const attachments = payload.attachments.map((attachment) => ({
		...attachment,
		id: mappedId(ids, { kind: 'attachment', sourceId: attachment.id })
	}))
	const recordsById = new Map(records.map((record) => [record.id, record]))
	const attachmentsById = new Map(attachments.map((file) => [file.id, file]))
	// Notebook root precedes notes; attachments precede all notes. Source tuples settle peer order.
	const ordered = data.mappings
		.map((mapping, index) => {
			const contents =
				mapping.kind === 'attachment'
					? attachmentsById.get(mapping.destinationId)
					: recordsById.get(mapping.destinationId)
			if (!contents) throw new Error('Unexpected notebook mapping')
			return {
				mappingIndexes: [index],
				contents: notebookCanonical(contents),
				projected: contents,
				sha256: '',
				rank: mapping.kind === 'attachment' ? 0 : mapping.type === 'notebook' ? 1 : 2
			}
		})
		.sort((left, right) => left.rank - right.rank)
	const batches: NotebookRestorePlanData['batches'] = []
	let indexes: number[] = [],
		contents: unknown[] = [],
		bytes = 2
	const flush = () => {
		if (!indexes.length) return
		batches.push({ mappingIndexes: indexes, contents: notebookCanonical(contents), sha256: '' })
		indexes = []
		contents = []
		bytes = 2
	}
	const encoder = new TextEncoder()
	for (const row of ordered) {
		if (row.rank !== 2) {
			flush()
			batches.push({
				mappingIndexes: row.mappingIndexes,
				contents: row.contents,
				sha256: row.sha256
			})
			continue
		}
		const size = encoder.encode(row.contents).byteLength
		if (
			indexes.length >= notebookNoteBatchLimits.records ||
			(indexes.length && bytes + size + 1 > notebookNoteBatchLimits.bytes)
		)
			flush()
		if (indexes.length) bytes++
		indexes.push(...row.mappingIndexes)
		contents.push(row.projected)
		bytes += size
	}
	flush()
	data.batches = batches
	data.graph = notebookCanonical({
		records: records.sort((a, b) => (a.id < b.id ? -1 : 1)),
		attachments: attachments.sort((a, b) => (a.id < b.id ? -1 : 1))
	})
}
export function projectNotebookControl(data: NotebookRestorePlanData): void {
	const row = {
		id: data.binding.workspaceId,
		ownerId: data.binding.identityId,
		operationId: data.binding.operationId,
		payloadSha256: data.archive.payloadDigest(),
		graphSha256: data.graphSha256
	}
	data.preparation = notebookCanonical({ ...row, status: 'incomplete' })
	data.activation = notebookCanonical({ ...row, status: 'active' })
}
export function notebookPlan(data: NotebookRestorePlanData) {
	return {
		id: 'dlf-notebook',
		version: 2,
		expectedGraphSha256: data.graphSha256,
		mappings: data.mappings,
		preparation: {
			writeId: 'prepare',
			expectedContentSha256: data.preparationSha256,
			mappingIndexes: []
		},
		batches: data.batches.map((batch, index) => ({
			writeId: 'batch-' + index,
			expectedContentSha256: batch.sha256,
			mappingIndexes: batch.mappingIndexes
		})),
		activation: { writeId: 'activate', expectedContentSha256: data.activationSha256 },
		requirements: { local: 'required', remote: 'required' }
	} satisfies Omit<RestoreJournalIntent['plan'], 'sha256'>
}
export function buildNotebookIntent(
	data: NotebookRestorePlanData,
	planSha256: string
): RestoreJournalIntent {
	const payload = data.archive.readPayload()
	return createRestoreJournalRecord({
		operation: {
			applicationId: data.binding.applicationId,
			environment: data.binding.environment,
			identityId: data.binding.identityId,
			operationId: data.binding.operationId,
			destinationWorkspaceId: data.binding.workspaceId
		},
		archive: {
			archiveId: payload.archiveId,
			payloadSha256: data.archive.payloadDigest(),
			profile: payload.profile,
			source: payload.source
		},
		plan: { ...notebookPlan(data), sha256: planSha256 }
	}).intent
}
/** Exactly one native digest operation. The owning actor selects which planned projection to hash. */
export function hashNotebookProjection(text: string): Promise<string> {
	return crypto.subtle
		.digest('SHA-256', new TextEncoder().encode(text))
		.then((buffer) =>
			Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
		)
}
