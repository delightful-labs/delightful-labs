import { describe, expect, it } from 'vitest'
import type { TransactionRow } from '#lib/schema.js'
import { groupTransactionsByDate } from '#lib/domain/transaction-groups.js'
import { filterTransactions, type TransactionListFilters } from './transaction-list-filters.js'

function row(id: string, overrides: Partial<TransactionRow> = {}): TransactionRow {
	return {
		id,
		organizationId: 'org',
		accountId: 'account',
		categoryId: 'food',
		kind: 'expense',
		source: 'manual',
		amountMinor: 100,
		currency: 'USD',
		bookedOn: '2026-10-15',
		description: null,
		memo: null,
		paymentMethod: null,
		checkId: null,
		checkDetailsId: null,
		internalTransferId: null,
		externalId: null,
		batchId: null,
		...overrides
	}
}

const categories = new Map([
	['food', 'Groceries'],
	['travel', 'Travel']
])
const tags = new Map([['match', ['Business trip']]])
function filter(rows: readonly TransactionRow[], overrides: Partial<TransactionListFilters> = {}) {
	return filterTransactions(
		rows,
		{
			start: '',
			end: '',
			categoryId: '',
			currency: '',
			query: '',
			...overrides
		},
		categories,
		tags
	)
}

describe('transaction list filtering', () => {
	it('includes all dates and currencies by default without changing input order or records', () => {
		const rows = [
			row('old', { bookedOn: '2020-01-01' }),
			row('future', { bookedOn: '2030-01-01', currency: 'EUR' })
		]
		expect(filter(rows)).toEqual(rows)
		expect(filter(rows)[0]).toBe(rows[0])
	})
	it('includes both date boundaries and supports either open bound', () => {
		const rows = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((bookedOn) =>
			row(bookedOn, { bookedOn })
		)
		expect(filter(rows, { start: '2026-10-02', end: '2026-10-03' }).map((r) => r.id)).toEqual([
			'2026-10-02',
			'2026-10-03'
		])
		expect(filter(rows, { start: '2026-10-03' }).map((r) => r.id)).toEqual([
			'2026-10-03',
			'2026-10-04'
		])
		expect(filter(rows, { end: '2026-10-02' }).map((r) => r.id)).toEqual([
			'2026-10-01',
			'2026-10-02'
		])
		expect(filter(rows, { start: '2026-10-03', end: '2026-10-02' })).toEqual([])
	})
	it('combines date, category, currency and search before grouping and totaling', () => {
		const rows = [
			row('match', { description: 'Lunch', memo: 'Client meeting', amountMinor: 123 }),
			row('wrong-date', { description: 'Lunch', bookedOn: '2026-10-14' }),
			row('wrong-category', { description: 'Lunch', categoryId: 'travel' }),
			row('wrong-currency', { description: 'Lunch', currency: 'EUR' }),
			row('wrong-text', { description: 'Dinner' })
		]
		const result = filter(rows, {
			start: '2026-10-15',
			end: '2026-10-15',
			categoryId: 'food',
			currency: 'USD',
			query: 'lunch'
		})
		expect(result.map((r) => r.id)).toEqual(['match'])
		expect([...groupTransactionsByDate(result)[0]!.totals]).toEqual([['USD', 123]])
	})
	it('matches all words across descriptions, memos, category names and tags regardless of case or spacing', () => {
		const rows = [
			row('match', { description: 'Weekly SHOP', memo: 'Client visit' }),
			row('other', { description: 'Weekly shop' })
		]
		expect(filter(rows, { query: '  SHOP\tclient\nGROCERIES  trip ' }).map((r) => r.id)).toEqual([
			'match'
		])
		expect(filter(rows, { query: 'shop missing' })).toEqual([])
	})
	it('handles empty queries, missing text and unavailable historical names', () => {
		const rows = [row('empty', { categoryId: 'removed' })]
		expect(filter(rows, { query: ' \n\t ' })).toEqual(rows)
		expect(filter(rows, { query: 'undefined' })).toEqual([])
		expect(filter(rows, { categoryId: 'removed' })).toEqual(rows)
		expect(filter([], { query: 'anything' })).toEqual([])
	})
})
