import { expect, it } from 'vitest'
import type { SyncAttempt } from '#lib/schema.js'
import { selectBankLogPresentation } from './history.js'

const attempt: SyncAttempt = {
	id: crypto.randomUUID(),
	organizationId: crypto.randomUUID(),
	connectionId: crypto.randomUUID(),
	initiatedBy: crypto.randomUUID(),
	startedAt: new Date('2026-11-04T22:42:46Z'),
	finishedAt: new Date('2026-11-04T22:44:42Z'),
	outcome: 'succeeded',
	importSettlement: 'notStarted',
	failureCode: null,
	importedCount: 0,
	existingCount: 56,
	omittedCount: 0
}
it.each([
	{ outcome: 'succeeded', importSettlement: 'notStarted', expected: 'Succeeded' },
	{ outcome: 'partial', importSettlement: 'notStarted', expected: 'Partial' },
	{ outcome: 'failed', importSettlement: 'notStarted', expected: 'not completed' },
	{ outcome: 'cancelled', importSettlement: 'notStarted', expected: 'not completed' },
	{ outcome: 'unfinished', importSettlement: 'notStarted', expected: 'not completed' },
	{ outcome: 'failed', importSettlement: 'locallyPersisted', expected: 'Saved' },
	{ outcome: 'succeeded', importSettlement: 'locallyPersisted', expected: 'Saved' },
	{ outcome: 'succeeded', importSettlement: 'confirmed', expected: 'Saved' }
] satisfies {
	outcome: SyncAttempt['outcome']
	importSettlement: SyncAttempt['importSettlement']
	expected: string
}[])(
	'shows $expected for $outcome with $importSettlement settlement',
	({ outcome, importSettlement, expected }) => {
		const row = { ...attempt, outcome, importSettlement }
		const view = selectBankLogPresentation({ connections: [], attempts: [row], accounts: [] })
			.attempts[0]
		expect(view?.importSettlement.label()).toBe(expected)
		expect(row.importSettlement).toBe(importSettlement)
	}
)
it('preserves uncertainty and import-failure details when some rows were saved', () => {
	const view = selectBankLogPresentation({
		connections: [],
		attempts: [
			{
				...attempt,
				outcome: 'failed',
				importedCount: 6,
				existingCount: 219,
				importSettlement: 'unresolved',
				failureCode: 'import'
			}
		],
		accounts: []
	}).attempts[0]
	if (!view) throw new Error('Missing attempt presentation')
	expect(view.outcome.label()).toBe('Failed')
	expect(view.importSettlement.label()).not.toBe('Saved')
	expect(view.failure?.label()).toBe('Could not save Transactions.')
})
