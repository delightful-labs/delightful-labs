import {
	parseRestoreJournalRecord,
	type RestoreJournalRecord,
	type RestoreJournalReceipt,
	type RestoreJournalCompletion
} from './restore-journal.js'

export function preparationPending(record: RestoreJournalRecord): boolean {
	return record.checkpoint.kind === 'writing' && record.checkpoint.completed.length === 0
}
export function preparationNotIssued(record: RestoreJournalRecord): boolean {
	return (
		preparationPending(record) &&
		record.checkpoint.kind === 'writing' &&
		record.checkpoint.current.status === 'notIssued'
	)
}
export function preparationCompleted(record: RestoreJournalRecord): boolean {
	return record.checkpoint.kind !== 'conflict' && record.checkpoint.completed.length > 0
}
export function preparationAttempt(record: RestoreJournalRecord): RestoreJournalReceipt {
	const checkpoint = record.checkpoint
	if (
		checkpoint.kind !== 'writing' ||
		checkpoint.completed.length !== 0 ||
		checkpoint.current.status !== 'issued'
	)
		throw new Error('Expected issued preparation')
	const { status: _status, ...receipt } = checkpoint.current
	return receipt
}
export function issuePreparation(record: RestoreJournalRecord): RestoreJournalRecord {
	if (!preparationNotIssued(record) || record.checkpoint.kind !== 'writing')
		throw new Error('Expected unissued preparation')
	return parseRestoreJournalRecord({
		...record,
		revision: record.revision + 1,
		checkpoint: {
			...record.checkpoint,
			current: {
				status: 'issued',
				writeId: record.intent.plan.preparation.writeId,
				issuance: record.checkpoint.current.issuance + 1,
				transactionId: null,
				settlement: { local: 'unobserved', remote: 'unobserved' }
			}
		}
	})
}
export function observePreparation(
	record: RestoreJournalRecord,
	transactionId: string,
	settlement: RestoreJournalReceipt['settlement']
): RestoreJournalRecord {
	const receipt = preparationAttempt(record)
	return parseRestoreJournalRecord({
		...record,
		revision: record.revision + 1,
		checkpoint: {
			kind: 'writing',
			completed: [],
			current: { status: 'issued', ...receipt, transactionId, settlement }
		}
	})
}
export function completePreparation(
	record: RestoreJournalRecord,
	completion: RestoreJournalCompletion
): RestoreJournalRecord {
	const next = record.intent.plan.batches[0]
	return parseRestoreJournalRecord({
		...record,
		revision: record.revision + 1,
		checkpoint: next
			? {
					kind: 'writing',
					completed: [completion],
					current: { status: 'notIssued', writeId: next.writeId, issuance: 0 }
				}
			: { kind: 'comparing', completed: [completion] }
	})
}
export function preparationCanReconcile(record: RestoreJournalRecord): boolean {
	if (!preparationPending(record) || preparationNotIssued(record)) return false
	return (
		record.intent.plan.requirements.local !== 'required' ||
		preparationAttempt(record).settlement.local === 'persisted'
	)
}
export function reconciledPreparation(record: RestoreJournalRecord): RestoreJournalRecord {
	const attempt = preparationAttempt(record)
	return completePreparation(record, {
		basis: 'remoteContentMatch',
		writeId: attempt.writeId,
		contentSha256: record.intent.plan.preparation.expectedContentSha256,
		localPersistence: attempt.settlement.local === 'persisted' ? 'persisted' : 'unobserved',
		attempt
	})
}

export function preparationSettlementSatisfied(record: RestoreJournalRecord): boolean {
	const observation = preparationAttempt(record).settlement
	const requirements = record.intent.plan.requirements
	return (
		observation.local !== 'rejected' &&
		observation.remote !== 'rejected' &&
		(requirements.local !== 'required' || observation.local === 'persisted') &&
		(requirements.remote !== 'required' || observation.remote === 'accepted')
	)
}
