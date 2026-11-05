import type { Snapshot } from 'xstate'
import type {
	RestoreTransactionWriter,
	RestoreDestinationLogic,
	RestoreDestinationResult
} from 'delightful-local-first/backup/restore'
import { createNotebookRestoreContinuationMachine } from './restore-continuation.js'
import { currentNotebookBatch } from './restore-step-data.js'
import {
	notebookRestoreData as data,
	prepareNotebookRestore,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreRequest,
	type NotebookRestoreOptions
} from './restore-request.js'

type Input = { request: NotebookRestoreRequest }
export function notebookCurrentStepIsNote(input: Input): boolean {
	const value = data(input),
		batch = currentNotebookBatch(input)
	if (!batch || batch.mappingIndexes.length !== 1) return false
	const index = batch.mappingIndexes[0]
	const mapping = index === undefined ? undefined : value.intent?.plan.mappings[index]
	return mapping?.kind === 'record' && mapping.type === 'note'
}
/** Pure projection of the checked exact profile and retained plan, no I/O or step selection. */
function prepareNotebookNote(input: Input): void {
	const value = data(input),
		intent = required(value.intent),
		batch = required(currentNotebookBatch(input))
	const mapping = required(intent.plan.mappings[required(batch.mappingIndexes[0])])
	if (batch.mappingIndexes.length !== 1 || mapping.kind !== 'record' || mapping.type !== 'note')
		throw new Error('Expected note batch')
	const source = required(
		value.archive
			.readPayload()
			.records.find((record) => record.type === 'note' && record.id === mapping.sourceId)
	)
	const { notebook, attachment, body, archived } = source.fields
	if (
		notebook?.kind !== 'reference' ||
		notebook.type !== 'notebook' ||
		body?.kind !== 'text' ||
		archived?.kind !== 'boolean' ||
		(attachment?.kind !== 'attachment' && attachment?.kind !== 'null')
	)
		throw new Error('Expected checked note fields')
	const notebookMapping = required(
		intent.plan.mappings.find(
			(entry) =>
				entry.kind === 'record' && entry.type === 'notebook' && entry.sourceId === notebook.id
		)
	)
	const attachmentId =
		attachment.kind === 'null'
			? null
			: required(
					intent.plan.mappings.find(
						(entry) => entry.kind === 'attachment' && entry.sourceId === attachment.id
					)
				).destinationId

	value.note = {
		id: mapping.destinationId,
		sourceId: mapping.sourceId,
		writeId: batch.writeId,
		contentSha256: batch.expectedContentSha256,
		payloadSha256: intent.archive.payloadSha256,
		destinationId: intent.operation.destinationWorkspaceId,
		ownerId: intent.operation.identityId,
		operationId: intent.operation.operationId,
		notebookId: notebookMapping.destinationId,
		attachmentId,
		body: body.value,
		archived: archived.value
	}
}
export function prepareNotebookNoteRestore(options: Omit<NotebookRestoreOptions, 'mode'>) {
	return prepareNotebookRestore({ ...options, mode: 'resume' })
}
export function createNotebookRestoreNoteMachine<
	Transaction,
	Write,
	S extends Snapshot<RestoreDestinationResult>
>(
	writer: RestoreTransactionWriter<Transaction, Write>,
	destination: RestoreDestinationLogic<Transaction, S>
) {
	return createNotebookRestoreContinuationMachine(writer, destination, {
		currentStep: notebookCurrentStepIsNote,
		prepareExpected: prepareNotebookNote,
		writeId: (input) => required(data(input).note).writeId,
		notApplicable: 'noNoteStep'
	})
}
