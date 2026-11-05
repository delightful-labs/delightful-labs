import type { Snapshot } from 'xstate'
import type {
	RestoreTransactionWriter,
	RestoreDestinationLogic,
	RestoreDestinationResult
} from 'delightful-local-first/backup/restore'
import { createNotebookRestoreContinuationMachine } from './restore-continuation.js'
import {
	notebookCurrentStepIsAttachment,
	prepareNotebookAttachmentBytes
} from './restore-attachment-data.js'
import {
	notebookRestoreData,
	prepareNotebookRestore,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreOptions
} from './restore-request.js'

export type NotebookAttachmentResult =
	import('./restore-continuation.js').NotebookContinuationResult<'noAttachmentStep'>
/** Same operation/file, new live generation. No new destination or mappings are allocated. */
export function prepareNotebookAttachmentRestore(options: Omit<NotebookRestoreOptions, 'mode'>) {
	return prepareNotebookRestore({ ...options, mode: 'resume' })
}
export function createNotebookRestoreAttachmentMachine<
	Transaction,
	Write,
	S extends Snapshot<RestoreDestinationResult>
>(
	writer: RestoreTransactionWriter<Transaction, Write>,
	destination: RestoreDestinationLogic<Transaction, S>
) {
	return createNotebookRestoreContinuationMachine(writer, destination, {
		currentStep: notebookCurrentStepIsAttachment,
		prepareExpected: prepareNotebookAttachmentBytes,
		writeId: (input) => required(notebookRestoreData(input).attachment).writeId,
		notApplicable: 'noAttachmentStep'
	})
}
