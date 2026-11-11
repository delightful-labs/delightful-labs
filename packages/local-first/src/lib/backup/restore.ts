import type { ActorLogic, Snapshot } from 'xstate'
import { backupBindingSchema, type BackupBinding } from './binding.js'
import {
	createRestoreJournalRecord,
	parseRestoreJournalRecord,
	type RestoreJournalIntent,
	type RestoreJournalRecord,
	type RestoreJournalReceipt,
	type RestoreJournalCompletion
} from './restore-journal.js'
import type { RetainDetachedTransaction } from '../contracts/transaction-custody.js'

export type RestoreScope = {
	binding: BackupBinding
	databaseName: string
	intent: RestoreJournalIntent
}
export type RestoreInput = RestoreScope & { writeId: string }
export type RestoreEvent =
	| { type: 'CANCEL' }
	| { type: 'SHUTDOWN' }
	| { type: 'INVALIDATE'; binding: BackupBinding }
export type RestoreOutcome =
	| 'prepared'
	| 'batchWritten'
	| 'complete'
	| 'incomplete'
	| 'conflict'
	| 'unavailable'
	| 'cancelled'
	| 'invalidated'
	| 'closed'
export type RestoreResult = {
	binding: BackupBinding
	outcome: RestoreOutcome
	record: RestoreJournalRecord | undefined
}
export type RestorePlannedWrite = RestoreJournalIntent['plan']['preparation']
export type RestoreStepPresence = 'match' | 'missingOrHidden' | 'conflict' | 'unavailable'
export type RestoreWriteInput = RestoreScope & {
	record: RestoreJournalRecord
	step: RestorePlannedWrite
}
export type RestoreWriteResult = Omit<RestoreResult, 'outcome'> & {
	outcome: Exclude<RestoreOutcome, 'prepared' | 'batchWritten' | 'complete'> | 'written'
}
export type RestoreTransactionWriter<Transaction, Write> = {
	open(): Transaction | Promise<Transaction>
	commit(transaction: Transaction): Write | Promise<Write>
	transactionId(write: Write): Promise<string>
	persistLocal(write: Write): Promise<void>
	acceptRemote(write: Write): Promise<void>
	isRemoteRejection(error: unknown, transactionId: string): boolean
	rollback(transaction: Transaction): Promise<boolean>
	retainDetached: RetainDetachedTransaction<Transaction, Write>
}
/** A tracked operation on the original borrowed transaction, never a replacement owner. */
export type RestoreTransactionAccess<Transaction> = {
	call<Result>(
		operation: (transaction: Transaction) => Result | PromiseLike<Result>
	): Promise<Result>
	toJSON(): { kind: 'restoreTransactionAccess' }
}
export type RestoreDestinationInput<Transaction> = RestoreScope & { step: RestorePlannedWrite } & (
		| { operation: 'remote' | 'authority' }
		| { operation: 'read' | 'stage'; transaction: RestoreTransactionAccess<Transaction> }
	)
export type RestoreDestinationResult =
	| RestoreStepPresence
	| 'allowed'
	| 'denied'
	| 'staged'
	| 'cancelled'
	| 'closed'
	| 'invalidated'
export type RestoreDestinationLogic<
	Transaction,
	S extends Snapshot<RestoreDestinationResult>
> = ActorLogic<S, RestoreEvent, RestoreDestinationInput<Transaction>>
export function restoreTransactionAccess<Transaction>(input: RestoreDestinationInput<Transaction>) {
	if (input.operation !== 'read' && input.operation !== 'stage')
		throw new Error('Expected transactional destination operation')
	return input.transaction
}
export function requireRestoreValue<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing restore resource')
	return value
}
/** Pure bounded normalization and selected-step correlation. Metadata grants no authority. */
export function validateRestoreInput(input: RestoreInput) {
	const parsed = backupBindingSchema.safeParse(input.binding)
	if (!parsed.success) throw new Error('Invalid restore binding')
	const record = createRestoreJournalRecord(input.intent),
		binding = parsed.data,
		operation = record.intent.operation
	if (
		operation.applicationId !== binding.applicationId ||
		operation.environment !== binding.environment ||
		operation.identityId !== binding.identityId ||
		operation.operationId !== binding.operationId ||
		operation.destinationWorkspaceId !== binding.workspaceId
	)
		throw new Error('Restore binding mismatch')
	const step = requireRestoreValue(
		[
			record.intent.plan.preparation,
			...record.intent.plan.batches,
			{ ...record.intent.plan.activation, mappingIndexes: [] }
		].find((step) => step.writeId === input.writeId)
	)
	return { binding, record, step }
}
export function writeStepPending(record: RestoreJournalRecord, step: RestorePlannedWrite): boolean {
	return (
		(record.checkpoint.kind === 'writing' || record.checkpoint.kind === 'activating') &&
		record.checkpoint.current.writeId === step.writeId
	)
}
export function writeStepNotIssued(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): boolean {
	return (
		writeStepPending(record, step) &&
		(record.checkpoint.kind === 'writing' || record.checkpoint.kind === 'activating') &&
		record.checkpoint.current.status === 'notIssued'
	)
}
/** Eligibility for an explicit invocation; current authority is checked by the write machine. */
export function writeStepCanIssue(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): boolean {
	const checkpoint = record.checkpoint
	return (
		(checkpoint.kind === 'writing' || checkpoint.kind === 'activating') &&
		checkpoint.current.writeId === step.writeId &&
		(checkpoint.current.status === 'notIssued' ||
			(checkpoint.current.transactionId !== null &&
				checkpoint.current.settlement.remote === 'rejected'))
	)
}
export function writeStepCompleted(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): boolean {
	return (
		record.checkpoint.kind !== 'conflict' &&
		(record.checkpoint.completed.some((receipt) => receipt.writeId === step.writeId) ||
			(record.checkpoint.kind === 'complete' &&
				record.checkpoint.activation.writeId === step.writeId))
	)
}
export function writeStepAttempt(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): RestoreJournalReceipt {
	const checkpoint = record.checkpoint
	if (
		(checkpoint.kind !== 'writing' && checkpoint.kind !== 'activating') ||
		checkpoint.current.writeId !== step.writeId ||
		checkpoint.current.status !== 'issued'
	)
		throw new Error('Expected issued restore step')
	const { status: _status, ...receipt } = checkpoint.current
	return receipt
}
export function issueWriteStep(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): RestoreJournalRecord {
	if (
		!writeStepCanIssue(record, step) ||
		(record.checkpoint.kind !== 'writing' && record.checkpoint.kind !== 'activating')
	)
		throw new Error('Expected eligible restore step')
	const current = record.checkpoint.current
	return parseRestoreJournalRecord({
		...record,
		revision: record.revision + 1,
		checkpoint: {
			...record.checkpoint,
			current: {
				status: 'issued',
				writeId: step.writeId,
				issuance: current.issuance + 1,
				transactionId: null,
				settlement: { local: 'unobserved', remote: 'unobserved' },
				...(current.status === 'issued'
					? {
							lastRejectedAttempt: {
								issuance: current.issuance,
								transactionId: current.transactionId,
								settlement: current.settlement
							}
						}
					: {})
			}
		}
	})
}
export function observeWriteStep(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite,
	transactionId: string,
	settlement: RestoreJournalReceipt['settlement']
): RestoreJournalRecord {
	const receipt = writeStepAttempt(record, step)
	if (record.checkpoint.kind !== 'writing' && record.checkpoint.kind !== 'activating')
		throw new Error('Expected writing checkpoint')
	return parseRestoreJournalRecord({
		...record,
		revision: record.revision + 1,
		checkpoint: {
			...record.checkpoint,
			current: { status: 'issued', ...receipt, transactionId, settlement }
		}
	})
}
export function completeWriteStep(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite,
	completion: RestoreJournalCompletion
): RestoreJournalRecord {
	if (
		!writeStepPending(record, step) ||
		(record.checkpoint.kind !== 'writing' && record.checkpoint.kind !== 'activating')
	)
		throw new Error('Expected current restore step')
	if (record.checkpoint.kind === 'activating')
		return parseRestoreJournalRecord({
			...record,
			revision: record.revision + 1,
			checkpoint: {
				kind: 'complete',
				completed: record.checkpoint.completed,
				comparison: record.checkpoint.comparison,
				activation: completion
			}
		})
	const completed = [...record.checkpoint.completed, completion]
	const next = record.intent.plan.batches[record.checkpoint.completed.length]
	return parseRestoreJournalRecord({
		...record,
		revision: record.revision + 1,
		checkpoint: next
			? {
					kind: 'writing',
					completed,
					current: { status: 'notIssued', writeId: next.writeId, issuance: 0 }
				}
			: { kind: 'comparing', completed }
	})
}
export function writeStepCanReconcile(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): boolean {
	if (!writeStepPending(record, step) || writeStepNotIssued(record, step)) return false
	return (
		record.intent.plan.requirements.local !== 'required' ||
		writeStepAttempt(record, step).settlement.local === 'persisted'
	)
}
export function reconcileWriteStep(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): RestoreJournalRecord {
	const attempt = writeStepAttempt(record, step)
	return completeWriteStep(record, step, {
		basis: 'remoteContentMatch',
		writeId: step.writeId,
		contentSha256: step.expectedContentSha256,
		localPersistence: attempt.settlement.local === 'persisted' ? 'persisted' : 'unobserved',
		attempt
	})
}
export function writeStepSettlementSatisfied(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): boolean {
	const observation = writeStepAttempt(record, step).settlement
	const requirements = record.intent.plan.requirements
	return (
		observation.local !== 'rejected' &&
		observation.remote !== 'rejected' &&
		(requirements.local !== 'required' || observation.local === 'persisted') &&
		(requirements.remote !== 'required' || observation.remote === 'accepted')
	)
}

export function requestedBatchIsCurrent(
	record: RestoreJournalRecord | undefined,
	writeId: string
): boolean {
	return (
		record?.checkpoint.kind === 'writing' &&
		record.checkpoint.completed.length > 0 &&
		record.checkpoint.current.writeId === writeId
	)
}
