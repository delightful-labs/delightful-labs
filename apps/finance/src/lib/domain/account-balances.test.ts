import { describe, expect, it } from 'vitest'
import { calculateAccountBalances } from './account-balances.js'
import { account, id } from '#lib/machines/bank-sync/test-fixtures.js'
import type { TransactionRow } from '#lib/schema.js'

const transaction = (values: {
	amountMinor: number
	kind: 'income' | 'expense'
	accountId?: string
	currency?: string
}) =>
	({
		id: id(20),
		organizationId: account.organizationId,
		accountId: values.accountId ?? account.id,
		currency: values.currency ?? account.currency,
		amountMinor: values.amountMinor,
		kind: values.kind,
		bookedOn: '2026-10-22',
		description: 'Test',
		source: 'manual',
		categoryId: id(22),
		paymentMethod: null,
		checkDetailsId: null,
		checkId: null,
		internalTransferId: null,
		externalId: null,
		memo: null,
		batchId: null
	}) satisfies TransactionRow

describe('calculateAccountBalances', () => {
	it('adds income and subtracts expenses using exact minor units', () => {
		const result = calculateAccountBalances(
			[account],
			[
				transaction({ amountMinor: 10_000, kind: 'income' }),
				transaction({ amountMinor: 2_525, kind: 'expense' })
			]
		)

		expect(result.get(account.id)).toBe(7_475n)
	})

	it('accepts only the fields required for balance calculation', () => {
		const result = calculateAccountBalances(
			[account],
			[
				{
					accountId: account.id,
					amountMinor: 1_250,
					currency: account.currency,
					kind: 'income'
				}
			]
		)

		expect(result.get(account.id)).toBe(1_250n)
	})

	it('returns zero for accounts without transactions and ignores other accounts or currencies', () => {
		const result = calculateAccountBalances(
			[account, { ...account, id: id(21), currency: 'EUR' }],
			[
				transaction({ accountId: id(99), amountMinor: 500, kind: 'income' }),
				transaction({ currency: 'EUR', amountMinor: 500, kind: 'income' })
			]
		)

		expect(result.get(account.id)).toBe(0n)
		expect(result.get(id(21))).toBe(0n)
	})
})
