import type { RestoreStepWriter } from 'delightful-local-first/backup/restore/batch'
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
export function notebookCurrentStepIsRoot(input: Input): boolean {
	const value = data(input),
		batch = currentNotebookBatch(input)
	if (!batch || batch.mappingIndexes.length !== 1) return false
	const index = batch.mappingIndexes[0]
	const mapping = index === undefined ? undefined : value.intent?.plan.mappings[index]
	return mapping?.kind === 'record' && mapping.type === 'notebook'
}
/** Pure projection of the checked exact profile and retained plan, no I/O or step selection. */
function prepareNotebookRoot(input: Input): void {
	const value = data(input),
		intent = required(value.intent),
		batch = required(currentNotebookBatch(input))
	const mapping = required(intent.plan.mappings[required(batch.mappingIndexes[0])])
	if (batch.mappingIndexes.length !== 1 || mapping.kind !== 'record' || mapping.type !== 'notebook')
		throw new Error('Expected notebook root batch')
	const source = required(
		value.archive
			.readPayload()
			.records.find((record) => record.type === 'notebook' && record.id === mapping.sourceId)
	)
	const title = source.fields.title
	if (title?.kind !== 'text') throw new Error('Expected checked notebook title')
	value.notebook = {
		id: mapping.destinationId,
		sourceId: mapping.sourceId,
		writeId: batch.writeId,
		contentSha256: batch.expectedContentSha256,
		payloadSha256: intent.archive.payloadSha256,
		destinationId: intent.operation.destinationWorkspaceId,
		ownerId: intent.operation.identityId,
		operationId: intent.operation.operationId,
		title: title.value
	}
}
export function prepareNotebookRootRestore(options: Omit<NotebookRestoreOptions, 'mode'>) {
	return prepareNotebookRestore({ ...options, mode: 'resume' })
}
export function createNotebookRestoreRootMachine<Transaction, Write>(
	writer: RestoreStepWriter<Transaction, Write>
) {
	return createNotebookRestoreContinuationMachine(writer, {
		currentStep: notebookCurrentStepIsRoot,
		prepareExpected: prepareNotebookRoot,
		writeId: (input) => required(data(input).notebook).writeId,
		notApplicable: 'noNotebookStep'
	})
}
