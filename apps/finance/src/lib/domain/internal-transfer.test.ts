import { describe, expect, it } from 'vitest'
import { EXPENSE, INCOME } from './transaction-kind.js'
import type { TransactionRow } from '#lib/schema.js'
import {
	findInternalTransferCounterparts,
	inspectInternalTransferCounterparts,
	resolveInternalTransferLinks
} from './internal-transfer.js'

type Candidate = Pick<
	TransactionRow,
	| 'id'
	| 'organizationId'
	| 'accountId'
	| 'kind'
	| 'amountMinor'
	| 'currency'
	| 'bookedOn'
	| 'internalTransferId'
>

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
	return {
		id,
		organizationId: 'workspace',
		accountId: 'destination',
		kind: INCOME,
		amountMinor: 1250,
		currency: 'USD',
		bookedOn: '2026-10-23',
		internalTransferId: null,
		...overrides
	}
}

const source = candidate('source', { accountId: 'source', kind: EXPENSE })

describe('internal transfer counterparts', () => {
	it('resolves only reciprocal links and suppresses every endpoint involved in a conflict', () => {
		const links = [
			{ id: 'transfer-b', expenseTransactionId: 'expense-b', incomeTransactionId: 'income' },
			{ id: 'transfer-a', expenseTransactionId: 'expense-a', incomeTransactionId: 'income' }
		]
		const transactions = [
			{ id: 'expense-a', internalTransferId: 'transfer-a' },
			{ id: 'expense-b', internalTransferId: 'transfer-b' },
			{ id: 'income', internalTransferId: 'transfer-a' },
			{ id: 'orphan-marker', internalTransferId: 'missing-transfer' },
			{ id: 'ordinary', internalTransferId: null }
		]

		const result = resolveInternalTransferLinks(links, transactions)

		expect(result.effectiveLinks).toEqual([links[1]])
		expect(result.pendingLinks).toEqual([])
		expect(result.conflictedLinks).toEqual([links[0]])
		expect(result.suppressedTransactionIds).toEqual(
			new Set(['expense-a', 'expense-b', 'income', 'orphan-marker'])
		)
	})

	it('keeps a locally staged unlink pending and treats a one-sided marker as a conflict', () => {
		const links = [
			{
				id: 'pending',
				expenseTransactionId: 'expense-pending',
				incomeTransactionId: 'income-pending'
			},
			{
				id: 'partial',
				expenseTransactionId: 'expense-partial',
				incomeTransactionId: 'income-partial'
			}
		]
		const transactions = [
			{ id: 'expense-pending', internalTransferId: null },
			{ id: 'income-pending', internalTransferId: null },
			{ id: 'expense-partial', internalTransferId: 'partial' },
			{ id: 'income-partial', internalTransferId: null }
		]

		const result = resolveInternalTransferLinks(links, transactions)

		expect(result.effectiveLinks).toEqual([])
		expect(result.pendingLinks).toEqual([links[0]])
		expect(result.conflictedLinks).toEqual([links[1]])
	})

	it('treats competing pending relationships as a conflict', () => {
		const links = [
			{ id: 'pending-a', expenseTransactionId: 'expense', incomeTransactionId: 'income-a' },
			{ id: 'pending-b', expenseTransactionId: 'expense', incomeTransactionId: 'income-b' }
		]
		const transactions = [
			{ id: 'expense', internalTransferId: null },
			{ id: 'income-a', internalTransferId: null },
			{ id: 'income-b', internalTransferId: null }
		]

		const result = resolveInternalTransferLinks(links, transactions)

		expect(result.pendingLinks).toEqual([])
		expect(result.conflictedLinks).toEqual(links)
	})

	it('returns effective and conflicted relationships in stable ID order', () => {
		const links = [
			{ id: 'transfer-z', expenseTransactionId: 'expense-z', incomeTransactionId: 'income-z' },
			{ id: 'transfer-a', expenseTransactionId: 'expense-a', incomeTransactionId: 'income-a' }
		]
		const transactions = links.flatMap(({ id, expenseTransactionId, incomeTransactionId }) => [
			{ id: expenseTransactionId, internalTransferId: id },
			{ id: incomeTransactionId, internalTransferId: id }
		])

		expect(resolveInternalTransferLinks(links, transactions).effectiveLinks).toEqual([
			links[1],
			links[0]
		])
		expect(
			resolveInternalTransferLinks(links.slice().reverse(), transactions).effectiveLinks
		).toEqual([links[1], links[0]])
	})

	it('reports each eligibility check for a rejected candidate', () => {
		const rejected = candidate('rejected', {
			accountId: source.accountId,
			kind: EXPENSE,
			amountMinor: 1251,
			currency: 'EUR',
			bookedOn: '2026-10-31',
			internalTransferId: 'existing-transfer'
		})

		expect(inspectInternalTransferCounterparts(source, [rejected], new Set([rejected.id]))).toEqual(
			[
				{
					candidate: rejected,
					checks: {
						sameWorkspace: true,
						differentAccount: false,
						oppositeKind: false,
						sameAmount: false,
						sameCurrency: false,
						withinDateWindow: false,
						sourceHasNoTransferMarker: true,
						sourceNotLinkedByTransferRecord: true,
						candidateHasNoTransferMarker: false,
						candidateNotLinkedByTransferRecord: false
					},
					eligible: false
				}
			]
		)
	})

	it('returns only opposite-kind transactions in another account with matching workspace, amount, and currency', () => {
		const eligible = candidate('eligible')
		const candidates = [
			eligible,
			candidate('same-account', { accountId: source.accountId }),
			candidate('same-kind', { kind: EXPENSE }),
			candidate('other-amount', { amountMinor: 1251 }),
			candidate('other-currency', { currency: 'EUR' }),
			candidate('other-workspace', { organizationId: 'another-workspace' })
		]

		expect(findInternalTransferCounterparts(source, candidates, new Set())).toEqual([eligible])
	})

	it('includes both seven-calendar-day boundaries and excludes the next day', () => {
		const candidates = [
			candidate('seven-before', { bookedOn: '2026-10-16' }),
			candidate('seven-after', { bookedOn: '2026-10-30' }),
			candidate('eight-before', { bookedOn: '2026-10-15' }),
			candidate('eight-after', { bookedOn: '2026-10-31' })
		]

		expect(
			findInternalTransferCounterparts(source, candidates, new Set()).map(({ id }) => id)
		).toEqual(['seven-before', 'seven-after'])
	})

	it('excludes linked candidates and returns no suggestions for a linked source', () => {
		const eligible = candidate('eligible')
		const alreadyLinked = candidate('linked')
		const candidates = [eligible, alreadyLinked]
		const linkedIds = new Set([alreadyLinked.id])

		expect(
			findInternalTransferCounterparts(source, candidates, linkedIds).map(({ id }) => id)
		).toEqual(['eligible'])
		expect(findInternalTransferCounterparts(source, candidates, new Set([source.id]))).toEqual([])
	})

	it('orders by nearest date, then date and ID without mutating the input', () => {
		const candidates = [
			candidate('same-day-z'),
			candidate('one-day-later', { bookedOn: '2026-10-24' }),
			candidate('same-day-a'),
			candidate('one-day-earlier', { bookedOn: '2026-10-22' })
		]
		const originalOrder = candidates.map(({ id }) => id)

		expect(
			findInternalTransferCounterparts(source, candidates, new Set()).map(({ id }) => id)
		).toEqual(['same-day-a', 'same-day-z', 'one-day-earlier', 'one-day-later'])
		expect(candidates.map(({ id }) => id)).toEqual(originalOrder)
	})
})
