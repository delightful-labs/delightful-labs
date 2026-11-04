import { describe, expect, it } from 'vitest'
import wire from '../../../tests/fixtures/restore-journal-v1.json'
import {
	decodeRestoreJournalRecord,
	encodeRestoreJournalRecord,
	parseRestoreJournalRecord,
	type RestoreJournalAttempt,
	type RestoreJournalCompletion,
	type RestoreJournalReceipt
} from './restore-journal.js'
import { isRestoreJournalSuccessor } from './restore-journal-successor.js'

function attempt(overrides: Partial<RestoreJournalReceipt> = {}): RestoreJournalReceipt {
	return {
		writeId: 'prepare',
		issuance: 1,
		transactionId: null,
		settlement: { local: 'unobserved', remote: 'unobserved' },
		...overrides
	}
}
function rejection(issuance = 1) {
	return {
		issuance,
		transactionId: `rejected-transaction-${issuance}`,
		settlement: { local: 'persisted', remote: 'rejected' }
	} satisfies RestoreJournalAttempt
}
function retry(issuance = 2): RestoreJournalReceipt {
	return attempt({ issuance, lastRejectedAttempt: rejection(issuance - 1) })
}
function writing(current: RestoreJournalReceipt, revision = 2) {
	return parseRestoreJournalRecord({
		...wire,
		revision,
		checkpoint: { kind: 'writing', completed: [], current: { status: 'issued', ...current } }
	})
}
function matched(current: RestoreJournalReceipt): RestoreJournalCompletion {
	return {
		basis: 'remoteContentMatch',
		writeId: current.writeId,
		contentSha256: '4'.repeat(64),
		localPersistence: 'persisted',
		attempt: current
	}
}
function advanced(completion: unknown, revision = 3) {
	return parseRestoreJournalRecord({
		...wire,
		revision,
		checkpoint: {
			kind: 'writing',
			completed: [completion],
			current: { status: 'notIssued', writeId: 'batch-notes', issuance: 0 }
		}
	})
}
function roundTrip(value: unknown) {
	return decodeRestoreJournalRecord(encodeRestoreJournalRecord(value))
}

describe('bounded transaction attempts', () => {
	it('retries a confirmed rejection at the same destination and completes the new transaction', () => {
		const rejected = writing(attempt(rejection()), 2)
		const retried = writing(retry(), 3)
		expect(isRestoreJournalSuccessor(rejected, retried)).toBe(true)
		expect(retried.intent).toEqual(rejected.intent)
		expect(roundTrip(retried)).toEqual(retried)
		const settled = attempt({
			...retry(),
			transactionId: 'new-transaction',
			settlement: { local: 'persisted', remote: 'accepted' }
		})
		const observed = writing(settled, 4)
		expect(isRestoreJournalSuccessor(retried, observed)).toBe(true)
		expect(isRestoreJournalSuccessor(observed, advanced(settled, 5))).toBe(true)
		expect(settled.lastRejectedAttempt).toEqual(rejection())
	})
	it('keeps only the most recent rejection when another attempt is needed', () => {
		const firstRetry = writing(retry(), 3)
		const secondRejected = writing(attempt({ ...retry(), ...rejection(2) }), 4)
		const secondRetry = writing(retry(3), 5)
		expect(isRestoreJournalSuccessor(firstRetry, secondRejected)).toBe(true)
		expect(isRestoreJournalSuccessor(secondRejected, secondRetry)).toBe(true)
		expect(roundTrip(secondRetry)).toEqual(secondRetry)
		if (
			secondRetry.checkpoint.kind !== 'writing' ||
			secondRetry.checkpoint.current.status !== 'issued'
		)
			throw new Error('Expected current attempt')
		expect(secondRetry.checkpoint.current.lastRejectedAttempt).toEqual(rejection(2))
		expect(Object.keys(secondRetry.checkpoint.current.lastRejectedAttempt ?? {}).sort()).toEqual([
			'issuance',
			'settlement',
			'transactionId'
		])
	})
	it.each([
		['no observations', attempt()],
		[
			'pending global acceptance',
			attempt({
				transactionId: 'pending',
				settlement: { local: 'persisted', remote: 'unobserved' }
			})
		],
		[
			'accepted write',
			attempt({ transactionId: 'accepted', settlement: { local: 'persisted', remote: 'accepted' } })
		],
		[
			'local failure alone',
			attempt({
				transactionId: 'local-failure',
				settlement: { local: 'rejected', remote: 'unobserved' }
			})
		],
		[
			'rejection without a transaction ID',
			attempt({ settlement: { local: 'persisted', remote: 'rejected' } })
		]
	])('does not admit another attempt for %s', (_label, current) => {
		expect(isRestoreJournalSuccessor(writing(current), writing(retry(), 3))).toBe(false)
	})
	it('rejects erased or changed rejection evidence within an attempt', () => {
		const before = writing(retry())
		expect(isRestoreJournalSuccessor(before, writing(attempt({ issuance: 2 }), 3))).toBe(false)
		expect(
			isRestoreJournalSuccessor(
				before,
				writing(
					attempt({
						...retry(),
						lastRejectedAttempt: { ...rejection(), transactionId: 'different-transaction' }
					}),
					3
				)
			)
		).toBe(false)
		expect(
			isRestoreJournalSuccessor(writing(attempt(rejection())), writing(attempt({ issuance: 2 }), 3))
		).toBe(false)
	})
	it('validates the previous attempt number and confirmed rejection metadata', () => {
		for (const lastRejectedAttempt of [
			rejection(2),
			{ ...rejection(), transactionId: null },
			{ ...rejection(), settlement: { local: 'persisted', remote: 'unobserved' } }
		]) {
			expect(() =>
				parseRestoreJournalRecord({
					...wire,
					revision: 3,
					checkpoint: {
						kind: 'writing',
						completed: [],
						current: { status: 'issued', ...retry(), lastRejectedAttempt }
					}
				})
			).toThrow('invalidJournal')
		}
	})
})

describe('completion by remote content comparison', () => {
	it.each([
		[
			'unknown transaction outcome',
			attempt({
				transactionId: 'pending',
				settlement: { local: 'persisted', remote: 'unobserved' }
			})
		],
		['rejected transaction outcome', attempt(rejection())]
	])('completes the planned step while retaining an %s', (_label, current) => {
		const before = writing(current)
		const after = advanced(matched(current))
		expect(isRestoreJournalSuccessor(before, after)).toBe(true)
		const decoded = roundTrip(after)
		expect(decoded).toEqual(after)
		if (decoded.checkpoint.kind !== 'writing') throw new Error('Expected writing checkpoint')
		expect(decoded.checkpoint.completed[0]).toEqual(matched(current))
		expect(Object.isFrozen(decoded.checkpoint.completed[0])).toBe(true)
		const entry = decoded.checkpoint.completed[0]
		if (!entry || !('basis' in entry)) throw new Error('Expected content comparison')
		expect(Object.isFrozen(entry.attempt)).toBe(true)
		expect(Object.isFrozen(entry.attempt.settlement)).toBe(true)
	})
	it('retains the previous rejected attempt when reconciling a retry', () => {
		expect(isRestoreJournalSuccessor(writing(retry()), advanced(matched(retry())))).toBe(true)
		expect(roundTrip(advanced(matched(retry())))).toEqual(advanced(matched(retry())))
	})
	it('does not rewrite an unknown transaction as accepted while recording a content match', () => {
		const current = attempt({ transactionId: 'pending' })
		const invented = attempt({ ...current, settlement: { local: 'persisted', remote: 'accepted' } })
		expect(isRestoreJournalSuccessor(writing(current), advanced(matched(invented)))).toBe(false)
	})
	it('requires the planned digest, write identity and separately required local persistence', () => {
		const completion = matched(attempt())
		for (const candidate of [
			{ ...completion, contentSha256: '9'.repeat(64) },
			{ ...completion, writeId: 'other-step' },
			{ ...completion, localPersistence: 'unobserved' }
		]) {
			expect(() => advanced(candidate)).toThrow('invalidJournal')
		}
	})
	it('allows a remote match without a local receipt only when local persistence is not required', () => {
		const value = advanced(matched(attempt()))
		if (value.checkpoint.kind !== 'writing') throw new Error('Expected writing checkpoint')
		const entry = value.checkpoint.completed[0]
		if (!entry || !('basis' in entry)) throw new Error('Expected content match')
		const relaxed = {
			...value,
			intent: {
				...value.intent,
				plan: { ...value.intent.plan, requirements: { local: 'notRequired', remote: 'required' } }
			},
			checkpoint: { ...value.checkpoint, completed: [{ ...entry, localPersistence: 'unobserved' }] }
		}
		expect(roundTrip(relaxed)).toEqual(relaxed)
	})
	it('supports activation reconciliation and keeps its completed evidence immutable', () => {
		const completed = ['prepare', 'batch-notes'].map((writeId) =>
			attempt({
				writeId,
				transactionId: `accepted-${writeId}`,
				settlement: { local: 'persisted', remote: 'accepted' }
			})
		)
		const current = attempt({ writeId: 'activate', transactionId: 'pending-activation' })
		const comparison = { payloadSha256: '1'.repeat(64), graphSha256: '3'.repeat(64) }
		const before = parseRestoreJournalRecord({
			...wire,
			revision: 8,
			checkpoint: {
				kind: 'activating',
				completed,
				comparison,
				current: { status: 'issued', ...current }
			}
		})
		const activation = { ...matched(current), contentSha256: '6'.repeat(64) }
		const after = parseRestoreJournalRecord({
			...wire,
			revision: 9,
			checkpoint: { kind: 'complete', completed, comparison, activation }
		})
		expect(isRestoreJournalSuccessor(before, after)).toBe(true)
		expect(roundTrip(after)).toEqual(after)
		expect(
			isRestoreJournalSuccessor(after, {
				...after,
				revision: 10,
				checkpoint: {
					...after.checkpoint,
					activation: { ...activation, attempt: { ...current, transactionId: 'changed' } }
				}
			})
		).toBe(false)
	})
})
