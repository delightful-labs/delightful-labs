import {
	parseRestoreJournalRecord,
	type RestoreJournalCheckpoint,
	type RestoreJournalCompletion,
	type RestoreJournalAttempt,
	type RestoreJournalRecord,
	type RestoreJournalReceipt
} from './restore-journal.js'

type Progress = Exclude<RestoreJournalCheckpoint, { kind: 'conflict' }>
type Evidence = RestoreJournalReceipt
function progress(checkpoint: RestoreJournalCheckpoint): Progress {
	return checkpoint.kind === 'conflict' ? checkpoint.prior : checkpoint
}
function unchanged(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}
function unobserved(value: Evidence): boolean {
	return (
		value.settlement.local === 'unobserved' &&
		value.settlement.remote === 'unobserved' &&
		value.transactionId === null
	)
}
function freshCurrent(
	value: Extract<Progress, { kind: 'writing' | 'activating' }>['current']
): boolean {
	return value.status === 'notIssued'
		? value.issuance === 0
		: value.issuance === 1 && unobserved(value) && value.lastRejectedAttempt === undefined
}
function retains(before: Evidence, after: Evidence): boolean {
	return (
		before.writeId === after.writeId &&
		before.issuance === after.issuance &&
		unchanged(before.lastRejectedAttempt, after.lastRejectedAttempt) &&
		(before.transactionId === null || before.transactionId === after.transactionId) &&
		(before.settlement.local === 'unobserved' ||
			before.settlement.local === after.settlement.local) &&
		(before.settlement.remote === 'unobserved' ||
			before.settlement.remote === after.settlement.remote)
	)
}
function evidence(step: string, value: Progress): RestoreJournalCompletion | undefined {
	if (value.kind === 'writing' || value.kind === 'activating') {
		if (value.current.writeId === step && value.current.status === 'issued') return value.current
	}
	if (value.kind === 'complete' && value.activation.writeId === step) return value.activation
	return value.completed.find((entry) => entry.writeId === step)
}

/** Pure CAS invariant gate, not a lifecycle reducer, authority check or absence proof. */
export function isRestoreJournalSuccessor(previous: unknown, candidate: unknown): boolean {
	return isValidatedRestoreJournalSuccessor(
		parseRestoreJournalRecord(previous),
		parseRestoreJournalRecord(candidate)
	)
}
/** Internal boundary: both records have already been normalized and frozen by the codec. */
export function isValidatedRestoreJournalSuccessor(
	before: RestoreJournalRecord,
	after: RestoreJournalRecord
): boolean {
	if (after.revision !== before.revision + 1 || !unchanged(after.intent, before.intent))
		return false
	if (before.checkpoint.kind === 'conflict') return unchanged(before.checkpoint, after.checkpoint)
	const old = progress(before.checkpoint),
		next = progress(after.checkpoint)
	if (
		next.completed.length < old.completed.length ||
		next.completed.length > old.completed.length + 1
	)
		return false
	if (!old.completed.every((receipt, index) => unchanged(receipt, next.completed[index])))
		return false
	if (old.kind === 'complete')
		return (
			next.kind === 'complete' &&
			unchanged(old.activation, next.activation) &&
			unchanged(old.comparison, next.comparison)
		)
	if (next.kind === 'complete' && !(old.kind === 'activating' && old.current.status === 'issued'))
		return false
	if (old.kind === 'comparing') {
		if (next.kind !== 'activating') return next.kind === 'comparing'
		return freshCurrent(next.current)
	}
	if (old.current.status === 'notIssued') {
		if (next.kind !== 'writing' && next.kind !== 'activating')
			return old.kind === 'activating' && next.kind === 'comparing'
		if (next.current.writeId !== old.current.writeId) return false
		return next.current.status === 'notIssued'
			? next.current.issuance === old.current.issuance
			: next.current.issuance === old.current.issuance + 1 &&
					unobserved(next.current) &&
					next.current.lastRejectedAttempt === undefined
	}
	if (
		(next.kind === 'writing' || next.kind === 'activating') &&
		next.current.writeId !== old.current.writeId &&
		!freshCurrent(next.current)
	)
		return false
	const retained = evidence(old.current.writeId, next)
	if (!retained) return false
	if ('basis' in retained)
		// Content comparison completes the step without changing the attempt's transaction facts.
		return retains(old.current, retained.attempt) && retains(retained.attempt, old.current)
	if (retains(old.current, retained)) return true
	// A new attempt only follows an explicit authority rejection. Uncertain writes stay unresolved.
	const rejected: RestoreJournalAttempt = {
		issuance: old.current.issuance,
		settlement: old.current.settlement,
		transactionId: old.current.transactionId
	}
	return (
		(next.kind === 'writing' || next.kind === 'activating') &&
		next.current.status === 'issued' &&
		next.current.writeId === old.current.writeId &&
		next.current.issuance === old.current.issuance + 1 &&
		old.current.settlement.remote === 'rejected' &&
		old.current.transactionId !== null &&
		unchanged(next.current.lastRejectedAttempt, rejected) &&
		unobserved(next.current)
	)
}
