import { describe, expect, it } from 'vitest'
import { internalTransferEntrySchema } from './internal-transfer-entry.js'

const accounts = {
	expenseAccountId: '11111111-1111-4111-8111-111111111111',
	incomeAccountId: '22222222-2222-4222-8222-222222222222',
	bookedOn: '2026-10-25'
}

describe('internal transfer entry schema', () => {
	it('parses independently entered amounts using each account currency', () => {
		expect(
			internalTransferEntrySchema.parse({
				...accounts,
				amountMode: 'separate',
				expenseCurrency: 'USD',
				incomeCurrency: 'TZS',
				expenseAmount: '42.17',
				incomeAmount: '65000.00'
			})
		).toEqual({
			...accounts,
			expenseAmountMinor: 4217,
			incomeAmountMinor: 6500000,
			expenseCurrency: 'USD',
			incomeCurrency: 'TZS'
		})
	})

	it('rejects TZS amounts beyond two minor-unit digits', () => {
		const result = internalTransferEntrySchema.safeParse({
			...accounts,
			amountMode: 'separate',
			expenseCurrency: 'USD',
			incomeCurrency: 'TZS',
			expenseAmount: '42.17',
			incomeAmount: '65000.001'
		})

		expect(result.success).toBe(false)
		if (result.success) return
		expect(result.error.issues.map(({ path }) => path)).toContainEqual(['incomeAmount'])
	})

	it('uses one amount and currency for same-currency accounts', () => {
		expect(
			internalTransferEntrySchema.parse({
				...accounts,
				amountMode: 'shared',
				currency: 'TZS',
				amount: '65000.00'
			})
		).toEqual({
			...accounts,
			expenseAmountMinor: 6500000,
			incomeAmountMinor: 6500000,
			expenseCurrency: 'TZS',
			incomeCurrency: 'TZS'
		})
	})
})
