// Standalone public ESM import: no Svelte/Jazz/browser session or Zod schema from the consumer.
import {
	encodeArchivePayload,
	parseArchivePayload,
	isArchivePayloadError,
	createArchivePayloadError
} from 'delightful-local-first/backup/archive'

/** @type {import('delightful-local-first/backup/archive').ArchivePayload} */
const source = {
	archiveId: '12345678-1234-4234-8234-123456789abc',
	profile: { id: 'consumer.notes', version: 1 },
	source: { applicationId: 'consumer', workspaceId: 'workspace' },
	capturedAt: '2026-11-03T00:00:00.000Z',
	coverage: {
		mode: 'complete-supported-graph',
		recordTypes: ['note'],
		history: 'current-data',
		deletedRecords: 'excluded',
		consistency: 'quiescent-single-user'
	},
	records: [
		{ type: 'note', id: 'one', fields: { exact: { kind: 'integer', value: '9007199254740993' } } }
	],
	attachments: [],
	references: []
}
const restored = parseArchivePayload(encodeArchivePayload(source))
const field = restored.records[0]?.fields.exact
if (field?.kind !== 'integer' || field.value !== '9007199254740993' || !Object.isFrozen(restored)) {
	throw new Error('Packaged archive codec failed exact-value preservation or immutability')
}

let failure
try {
	encodeArchivePayload({})
} catch (error) {
	failure = error
}
if (
	!isArchivePayloadError(failure) ||
	failure.code !== 'invalidPayload' ||
	failure.message !== 'invalidPayload'
) {
	throw new Error('Packaged codec error classification changed')
}
if (!isArchivePayloadError(createArchivePayloadError('limitExceeded'))) {
	throw new Error('Packaged error factory/guard exports do not agree')
}
