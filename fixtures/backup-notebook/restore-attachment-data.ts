import { payloadLimits } from 'delightful-local-first/backup/archive'
import { currentNotebookBatch } from './restore-step-data.js'
import {
	notebookRestoreData as data,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreRequest
} from './restore-request.js'

type Input = { request: NotebookRestoreRequest }
export function notebookCurrentStepIsAttachment(input: Input): boolean {
	const value = data(input),
		batch = currentNotebookBatch(input)
	if (!batch || batch.mappingIndexes.length !== 1) return false
	const index = batch.mappingIndexes[0]
	return index !== undefined && value.intent?.plan.mappings[index]?.kind === 'attachment'
}
/** Bounded projection of the already checked file. Workflow eligibility is guarded by the root. */
export function prepareNotebookAttachmentBytes(input: Input): void {
	const value = data(input),
		intent = required(value.intent),
		batch = required(currentNotebookBatch(input))
	const index = required(batch.mappingIndexes[0]),
		mapping = required(intent.plan.mappings[index])
	if (mapping.kind !== 'attachment' || batch.mappingIndexes.length !== 1)
		throw new Error('Expected attachment batch')
	const source = required(
		value.archive.readPayload().attachments.find((file) => file.id === mapping.sourceId)
	)
	if (source.sizeBytes > payloadLimits.attachmentBytes)
		throw new Error('Attachment bounds exceeded')
	const decoded = atob(source.data)
	if (decoded.length !== source.sizeBytes) throw new Error('Attachment byte count mismatch')
	const contents = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
	value.attachment = {
		id: mapping.destinationId,
		sourceId: mapping.sourceId,
		writeId: batch.writeId,
		contentSha256: batch.expectedContentSha256,
		payloadSha256: intent.archive.payloadSha256,
		destinationId: intent.operation.destinationWorkspaceId,
		ownerId: intent.operation.identityId,
		operationId: intent.operation.operationId,
		mediaType: source.mediaType,
		fileName: source.fileName,
		sizeBytes: source.sizeBytes,
		sha256: source.sha256,
		contents
	}
}

export {
	notebookRecoveryIntentMatches,
	notebookRecoveryConflict,
	notebookPreparationComplete,
	currentNotebookBatch
} from './restore-step-data.js'
