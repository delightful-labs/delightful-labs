import { describe, expect, it } from 'vitest'
import { transactionKindForPath, transactionPages } from './transaction-kind.js'

describe('transaction page configuration', () => {
	it.each([
		['/income', 'income'],
		['/income/new', 'income'],
		['/income/record', 'income'],
		['/expenses', 'expense'],
		['/expenses/new', 'expense'],
		['/expenses/record', 'expense'],
		['/income-other', 'expense'],
		['/incomes', 'expense']
	])('resolves %s to %s', (path, kind) => {
		expect(transactionKindForPath(path)).toBe(kind)
	})

	it('keeps income entry editable and expense payment references preserved', () => {
		expect(transactionPages.income).toEqual({
			path: '/income',
			noun: 'nouns.income',
			count: 1,
			paymentEntry: 'inline'
		})
		expect(transactionPages.expense).toEqual({
			path: '/expenses',
			noun: 'nouns.expense',
			count: 2,
			paymentEntry: 'preserve'
		})
	})
})
