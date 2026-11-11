import { matchRestoreJournalIntent } from 'delightful-local-first/backup/restore/journal'
import { testAppRestoreData as data, type TestAppRestoreRequest } from './restore-request.js'
type Input = { request: TestAppRestoreRequest }
export function testAppRecoveryIntentMatches(input: Input): boolean {
	const value = data(input)
	return (
		value.intent !== undefined &&
		value.observedJournal !== undefined &&
		matchRestoreJournalIntent(value.observedJournal, value.intent)
	)
}
export function testAppRecoveryConflict(input: Input): boolean {
	return data(input).observedJournal?.checkpoint.kind === 'conflict'
}
export function testAppPreparationComplete(input: Input): boolean {
	const checkpoint = data(input).observedJournal?.checkpoint
	return (
		checkpoint !== undefined && checkpoint.kind !== 'conflict' && checkpoint.completed.length > 0
	)
}
export function currentTestAppBatch(input: Input, record = data(input).observedJournal) {
	const value = data(input)
	if (!record || record.checkpoint.kind !== 'writing' || record.checkpoint.completed.length === 0)
		return undefined
	const batch = value.intent?.plan.batches[record.checkpoint.completed.length - 1]
	return batch?.writeId === record.checkpoint.current.writeId ? batch : undefined
}
