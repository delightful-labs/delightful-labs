import { describe, expect, it } from 'vitest'
import type { TransactionRow } from '../queries.js'
import { groupTransactionsByDate, paginateTransactionGroups } from './transaction-groups.js'

function row(id: string, bookedOn: string, amountMinor: number, currency = 'USD'): TransactionRow {
	return {
		id,
		bookedOn,
		amountMinor,
		currency,
		organizationId: 'workspace',
		accountId: 'account',
		categoryId: 'category',
		kind: 'expense',
		source: 'manual',
		description: null,
		memo: null,
		paymentMethod: null,
		checkId: null,
		checkDetailsId: null,
		internalTransferId: null,
		externalId: null,
		batchId: null
	}
}

describe('transaction date grouping', () => {
	it('handles empty results', () => {
		expect(groupTransactionsByDate([])).toEqual([])
	})
	it('sorts days newest first and retains input order within a day', () => {
		const input = [
			row('old', '2025-12-31', 100),
			row('first', '2026-01-01', 200),
			row('second', '2026-01-01', 300)
		]
		const groups = groupTransactionsByDate(input)
		expect(groups.map((group) => group.bookedOn)).toEqual(['2026-01-01', '2025-12-31'])
		expect(groups[0]?.transactions.map((transaction) => transaction.id)).toEqual([
			'first',
			'second'
		])
		expect(input.map((transaction) => transaction.id)).toEqual(['old', 'first', 'second'])
	})
	it('sums integer minor units separately for each currency and day', () => {
		const groups = groupTransactionsByDate([
			row('one', '2026-10-14', 10),
			row('two', '2026-10-14', 20),
			row('eur', '2026-10-14', 15, 'EUR'),
			row('old', '2026-10-13', 100)
		])
		expect([...groups[0]!.totals]).toEqual([
			['USD', 30n],
			['EUR', 15n]
		])
		expect([...groups[1]!.totals]).toEqual([['USD', 100n]])
	})
	it('totals only the supplied filtered transactions including zero amounts', () => {
		const groups = groupTransactionsByDate([row('visible', '2026-10-14', 0)])
		expect(groups[0]?.totals.get('USD')).toBe(0n)
		expect(groups[0]?.transactions).toHaveLength(1)
	})
})

it('keeps exact day totals above Number precision and retains them across page splits', () => {
	const values = Array.from({ length: 30 }, (_, i) =>
		row(String(i), '2026-11-18', Number.MAX_SAFE_INTEGER)
	)
	const groups = groupTransactionsByDate(values)
	expect(groups[0]?.totals.get('USD')).toBe(270215977642229730n)
	const first = paginateTransactionGroups(groups, 1),
		last = paginateTransactionGroups(groups, 99)
	expect(first.groups.flatMap((g) => g.transactions).map((t) => t.id)).toEqual(
		Array.from({ length: 25 }, (_, i) => String(i))
	)
	expect(last.page).toBe(2)
	expect(last.pageCount).toBe(2)
	expect(last.groups.flatMap((g) => g.transactions).map((t) => t.id)).toEqual([
		'25',
		'26',
		'27',
		'28',
		'29'
	])
	expect(last.groups[0]?.totals.get('USD')).toBe(270215977642229730n)
	expect(values).toHaveLength(30)
})
