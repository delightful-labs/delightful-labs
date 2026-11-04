import { backupBindingSchema, type BackupBinding } from './export.js'
import {
	createRestoreJournalRecord,
	type RestoreJournalIntent,
	type RestoreJournalRecord
} from './restore-journal.js'
import type { RetainDetachedTransaction } from '../contracts/transaction-custody.js'

/** Trusted consumer input. Rebuild the entire intent from the checked archive before invocation. */
export type RestorePreparationInput = {
	binding: BackupBinding
	databaseName: string
	intent: RestoreJournalIntent
}
export type RestorePreparationEvent =
	| { type: 'CANCEL' }
	| { type: 'SHUTDOWN' }
	| { type: 'INVALIDATE'; binding: BackupBinding }
export type RestorePreparationOutcome =
	| 'prepared'
	| 'incomplete'
	| 'conflict'
	| 'unavailable'
	| 'cancelled'
	| 'invalidated'
	| 'closed'
export type RestorePreparationResult = {
	binding: BackupBinding
	outcome: RestorePreparationOutcome
	/** Immutable private recovery metadata; never log or use as an authority capability. */
	record: RestoreJournalRecord | undefined
}
export type PreparationPresence = 'match' | 'missingOrHidden' | 'conflict'

/** Each method is one SDK leaf, or the pure classification of that leaf's result. */
export type RestorePreparationWriter<Transaction, Write> = {
	readRemote(intent: RestoreJournalIntent): Promise<PreparationPresence>
	checkAuthority(intent: RestoreJournalIntent): Promise<boolean>
	open(): Transaction | Promise<Transaction>
	readTransaction(
		transaction: Transaction,
		intent: RestoreJournalIntent
	): Promise<PreparationPresence>
	stage(transaction: Transaction, intent: RestoreJournalIntent): void | Promise<void>
	commit(transaction: Transaction): Write | Promise<Write>
	transactionId(write: Write): Promise<string>
	persistLocal(write: Write): Promise<void>
	acceptRemote(write: Write): Promise<void>
	/** Narrow documented rejection only. A generic error cannot become a server rejection. */
	isRemoteRejection(error: unknown, transactionId: string): boolean
	rollback(transaction: Transaction): Promise<boolean>
	retainDetached: RetainDetachedTransaction<Transaction, Write>
}

export function requirePreparationValue<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing restore preparation resource')
	return value
}

/** Pure input normalization/correlation. Journal metadata never grants destination authority. */
export function validatePreparationInput(input: RestorePreparationInput) {
	const parsed = backupBindingSchema.safeParse(input.binding)
	if (!parsed.success) throw new Error('Invalid restore preparation binding')
	const record = createRestoreJournalRecord(input.intent)
	const binding = parsed.data
	const operation = record.intent.operation
	if (
		operation.applicationId !== binding.applicationId ||
		operation.environment !== binding.environment ||
		operation.identityId !== binding.identityId ||
		operation.operationId !== binding.operationId ||
		operation.destinationWorkspaceId !== binding.workspaceId
	)
		throw new Error('Restore preparation binding mismatch')
	return { binding, record }
}
