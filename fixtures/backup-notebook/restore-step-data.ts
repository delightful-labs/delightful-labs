import { matchRestoreJournalIntent } from 'delightful-local-first/backup/restore/journal'
import { notebookRestoreData as data, type NotebookRestoreRequest } from './restore-request.js'
type Input = { request: NotebookRestoreRequest }
export function notebookRecoveryIntentMatches(input: Input): boolean {
	const value = data(input)
	return (
		value.intent !== undefined &&
		value.observedJournal !== undefined &&
		matchRestoreJournalIntent(value.observedJournal, value.intent)
	)
}
export function notebookRecoveryConflict(input: Input): boolean {
	return data(input).observedJournal?.checkpoint.kind === 'conflict'
}
export function notebookPreparationComplete(input: Input): boolean {
	const checkpoint = data(input).observedJournal?.checkpoint
	return (
		checkpoint !== undefined && checkpoint.kind !== 'conflict' && checkpoint.completed.length > 0
	)
}
export function currentNotebookBatch(input: Input) {
	const value = data(input),
		record = value.observedJournal
	if (!record || record.checkpoint.kind !== 'writing' || record.checkpoint.completed.length === 0)
		return undefined
	const batch = value.intent?.plan.batches[record.checkpoint.completed.length - 1]
	return batch?.writeId === record.checkpoint.current.writeId ? batch : undefined
}
