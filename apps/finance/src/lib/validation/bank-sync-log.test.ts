import { expect, it } from 'vitest'
import { syncAttemptSchema, syncAccountResultSchema } from './bank-sync-log.js'
const attempt = {
	organizationId: crypto.randomUUID(),
	connectionId: crypto.randomUUID(),
	initiatedBy: crypto.randomUUID(),
	startedAt: new Date('2026-10-30T12:00:00Z'),
	finishedAt: null,
	outcome: 'unfinished',
	importSettlement: 'notStarted',
	importedCount: null,
	existingCount: null,
	omittedCount: null,
	failureCode: null
}
it('preserves unavailable counts separately from zero', () => {
	expect(syncAttemptSchema.parse(attempt).importedCount).toBeNull()
	expect(syncAttemptSchema.parse({ ...attempt, importedCount: 0 }).importedCount).toBe(0)
})
it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid counts %s', (importedCount) => {
	expect(syncAttemptSchema.safeParse({ ...attempt, importedCount }).success).toBe(false)
})
it('rejects missing or contradictory completion times and arbitrary error payloads', () => {
	expect(syncAttemptSchema.safeParse({ ...attempt, outcome: 'succeeded' }).success).toBe(false)
	expect(syncAttemptSchema.safeParse({ ...attempt, finishedAt: new Date() }).success).toBe(false)
	expect(
		syncAttemptSchema.safeParse({
			...attempt,
			outcome: 'failed',
			finishedAt: new Date('2026-10-29')
		}).success
	).toBe(false)
	expect(
		syncAttemptSchema.safeParse({ ...attempt, failureCode: 'private-provider-response' }).success
	).toBe(false)
	expect(syncAttemptSchema.safeParse({ ...attempt, accessUrl: 'private' }).success).toBe(false)
})
it('requires an account identity and historical name without accepting extra payloads', () => {
	const row = {
		attemptId: crypto.randomUUID(),
		organizationId: attempt.organizationId,
		accountId: crypto.randomUUID(),
		accountName: 'Checking',
		outcome: 'succeeded',
		failureCode: null,
		importedCount: 1,
		existingCount: 0,
		omittedCount: 0
	}
	expect(syncAccountResultSchema.safeParse(row).success).toBe(true)
	expect(syncAccountResultSchema.safeParse({ ...row, accountName: '' }).success).toBe(false)
	expect(syncAccountResultSchema.safeParse({ ...row, response: {} }).success).toBe(false)
})
