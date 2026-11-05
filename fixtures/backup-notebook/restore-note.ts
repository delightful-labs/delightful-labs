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
	return (
		batch !== undefined &&
		batch.mappingIndexes.length > 0 &&
		batch.mappingIndexes.every((index) => {
			const mapping = value.intent?.plan.mappings[index]
			return mapping?.kind === 'record' && mapping.type === 'note'
		})
	)
}
/** Pure projection of the checked exact profile and retained plan, no I/O or step selection. */
export function prepareNotebookNote(input: Input): void {
	const value = data(input),
		intent = required(value.intent),
		batch = required(currentNotebookBatch(input))
	if (!notebookCurrentStepIsNote(input)) throw new Error('Expected note batch')
	const sources = new Map(
		value.archive
			.readPayload()
			.records.filter((record) => record.type === 'note')
			.map((record) => [record.id, record])
	)
	const books = new Map(
		intent.plan.mappings
			.filter((mapping) => mapping.kind === 'record' && mapping.type === 'notebook')
			.map((mapping) => [mapping.sourceId, mapping.destinationId])
	)
	const files = new Map(
		intent.plan.mappings
			.filter((mapping) => mapping.kind === 'attachment')
			.map((mapping) => [mapping.sourceId, mapping.destinationId])
	)
	value.notes = batch.mappingIndexes.map((index) => {
		const mapping = required(intent.plan.mappings[index])
		if (mapping.kind !== 'record' || mapping.type !== 'note')
			throw new Error('Expected note mapping')
		const source = required(sources.get(mapping.sourceId))
		const { notebook, attachment, body, archived } = source.fields
		if (
			notebook?.kind !== 'reference' ||
			notebook.type !== 'notebook' ||
			body?.kind !== 'text' ||
			archived?.kind !== 'boolean' ||
			(attachment?.kind !== 'attachment' && attachment?.kind !== 'null')
		)
			throw new Error('Expected checked note fields')
		const notebookId = required(books.get(notebook.id))
		const attachmentId = attachment.kind === 'null' ? null : required(files.get(attachment.id))

		return {
			id: mapping.destinationId,
			sourceId: mapping.sourceId,
			writeId: batch.writeId,
			contentSha256: batch.expectedContentSha256,
			payloadSha256: intent.archive.payloadSha256,
			destinationId: intent.operation.destinationWorkspaceId,
			ownerId: intent.operation.identityId,
			operationId: intent.operation.operationId,
			notebookId,
			attachmentId,
			body: body.value,
			archived: archived.value
		}
	})
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
		writeId: (input) => required(required(data(input).notes)[0]).writeId,
		notApplicable: 'noNoteStep'
	})
}
