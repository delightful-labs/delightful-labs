import type {
	RestoreJournalRecord,
	RestoreJournalIntent,
	RestoreJournalReceipt,
	RestoreJournalCompletion
} from './restore-journal.js'
import { parseRestoreJournalRecord } from './restore-journal.js'
import { validatePreparationInput } from './restore-preparation.js'
import type {
	RestorePreparationInput,
	RestorePreparationOutcome,
	RestorePreparationResult,
	RestorePreparationWriter,
	PreparationPresence
} from './restore-preparation.js'

export type RestorePlannedWrite = RestoreJournalIntent['plan']['preparation']
export type RestoreStepPresence = PreparationPresence | 'unavailable'
export type RestoreWriteInput = RestorePreparationInput & { record: RestoreJournalRecord }
export type RestoreBatchInput = RestorePreparationInput & { writeId: string }
export type RestoreWriteResult<Success extends 'prepared' | 'batchWritten'> = Omit<
	RestorePreparationResult,
	'outcome'
> & { outcome: Exclude<RestorePreparationOutcome, 'prepared'> | Success }
export type RestoreStepWriter<Transaction, Write> = Omit<
	RestorePreparationWriter<Transaction, Write>,
	'readRemote' | 'readTransaction' | 'checkAuthority' | 'stage'
> & {
	readRemote(intent: RestoreJournalIntent, step: RestorePlannedWrite): Promise<RestoreStepPresence>
	readTransaction(
		transaction: Transaction,
		intent: RestoreJournalIntent,
		step: RestorePlannedWrite
	): Promise<RestoreStepPresence>
	checkAuthority(intent: RestoreJournalIntent, step: RestorePlannedWrite): Promise<boolean>
	stage(
		transaction: Transaction,
		intent: RestoreJournalIntent,
		step: RestorePlannedWrite
	): void | Promise<void>
}
export function writeStepPending(record: RestoreJournalRecord, step: RestorePlannedWrite): boolean {
	return record.checkpoint.kind === 'writing' && record.checkpoint.current.writeId === step.writeId
}
export function writeStepNotIssued(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): boolean {
	return (
		writeStepPending(record, step) &&
		record.checkpoint.kind === 'writing' &&
		record.checkpoint.current.status === 'notIssued'
	)
}
export function writeStepCompleted(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): boolean {
	return (
		record.checkpoint.kind !== 'conflict' &&
		record.checkpoint.completed.some((receipt) => receipt.writeId === step.writeId)
	)
}
export function writeStepAttempt(
	record: RestoreJournalRecord,
	step: RestorePlannedWrite
): RestoreJournalReceipt {
	const checkpoint = record.checkpoint
	if (
		checkpoint.kind !== 'writing' ||
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
	if (!writeStepNotIssued(record, step) || record.checkpoint.kind !== 'writing')
		throw new Error('Expected unissued restore step')
	return parseRestoreJournalRecord({
		...record,
		revision: record.revision + 1,
		checkpoint: {
			...record.checkpoint,
			current: {
				status: 'issued',
				writeId: step.writeId,
				issuance: record.checkpoint.current.issuance + 1,
				transactionId: null,
				settlement: { local: 'unobserved', remote: 'unobserved' }
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
	if (record.checkpoint.kind !== 'writing') throw new Error('Expected writing checkpoint')
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
	if (!writeStepPending(record, step) || record.checkpoint.kind !== 'writing')
		throw new Error('Expected current restore step')
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

/** Membership in the already bounded validated plan also bounds the requested write identity. */
export function validateRestoreBatchInput(input: RestoreBatchInput) {
	const normalized = validatePreparationInput(input)
	if (!normalized.record.intent.plan.batches.some((step) => step.writeId === input.writeId))
		throw new Error('Unknown restore batch')
	return normalized
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
