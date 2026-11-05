import type { Snapshot } from 'xstate'
import type {
	RestoreTransactionWriter,
	RestoreDestinationLogic,
	RestoreDestinationResult
} from 'delightful-local-first/backup/restore'
import { createTestAppRestoreContinuationMachine } from './restore-continuation.js'
import {
	testAppCurrentStepIsAttachment,
	prepareTestAppAttachmentBytes
} from './restore-attachment-data.js'
import {
	testAppRestoreData,
	prepareTestAppRestore,
	requiredTestAppRestoreValue as required,
	type TestAppRestoreOptions
} from './restore-request.js'

export type TestAppAttachmentResult =
	import('./restore-continuation.js').TestAppContinuationResult<'noAttachmentStep'>
/** Same operation/file, new live generation. No new destination or mappings are allocated. */
export function prepareTestAppAttachmentRestore(options: Omit<TestAppRestoreOptions, 'mode'>) {
	return prepareTestAppRestore({ ...options, mode: 'resume' })
}
export function createTestAppRestoreAttachmentMachine<
	Transaction,
	Write,
	S extends Snapshot<RestoreDestinationResult>
>(
	writer: RestoreTransactionWriter<Transaction, Write>,
	destination: RestoreDestinationLogic<Transaction, S>
) {
	return createTestAppRestoreContinuationMachine(writer, destination, {
		currentStep: testAppCurrentStepIsAttachment,
		prepareExpected: prepareTestAppAttachmentBytes,
		writeId: (input) => required(testAppRestoreData(input).attachment).writeId,
		notApplicable: 'noAttachmentStep'
	})
}
