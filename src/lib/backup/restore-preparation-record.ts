import type {
	RestoreJournalRecord,
	RestoreJournalReceipt,
	RestoreJournalCompletion
} from './restore-journal.js'
import {
	writeStepPending,
	writeStepNotIssued,
	writeStepCompleted,
	writeStepAttempt,
	issueWriteStep,
	observeWriteStep,
	completeWriteStep,
	writeStepCanReconcile,
	reconcileWriteStep,
	writeStepSettlementSatisfied
} from './restore-write-step.js'

export function preparationPending(record: RestoreJournalRecord) {
	return writeStepPending(record, record.intent.plan.preparation)
}
export function preparationNotIssued(record: RestoreJournalRecord) {
	return writeStepNotIssued(record, record.intent.plan.preparation)
}
export function preparationCompleted(record: RestoreJournalRecord) {
	return writeStepCompleted(record, record.intent.plan.preparation)
}
export function preparationAttempt(record: RestoreJournalRecord) {
	return writeStepAttempt(record, record.intent.plan.preparation)
}
export function issuePreparation(record: RestoreJournalRecord) {
	return issueWriteStep(record, record.intent.plan.preparation)
}
export function observePreparation(
	record: RestoreJournalRecord,
	transactionId: string,
	settlement: RestoreJournalReceipt['settlement']
) {
	return observeWriteStep(record, record.intent.plan.preparation, transactionId, settlement)
}
export function completePreparation(
	record: RestoreJournalRecord,
	completion: RestoreJournalCompletion
) {
	return completeWriteStep(record, record.intent.plan.preparation, completion)
}
export function preparationCanReconcile(record: RestoreJournalRecord) {
	return writeStepCanReconcile(record, record.intent.plan.preparation)
}
export function reconciledPreparation(record: RestoreJournalRecord) {
	return reconcileWriteStep(record, record.intent.plan.preparation)
}
export function preparationSettlementSatisfied(record: RestoreJournalRecord) {
	return writeStepSettlementSatisfied(record, record.intent.plan.preparation)
}
