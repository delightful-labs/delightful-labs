import { describe, expect, it } from 'vitest'
import type { TransactionEntryScope } from './transaction-entry-contract.js'
import { ledgerValues, parseSaveRequest } from './transaction-save-contract.js'
import type { TransactionSaveValues } from '../validation/transactions.js'

const binding = {}
const scope: TransactionEntryScope = {
	identityId: 'user',
	organizationId: '22222222-2222-4222-8222-222222222222',
	binding,
	kind: 'expense'
}
const values: TransactionSaveValues = {
	organizationId: scope.organizationId ?? '',
	accountId: '11111111-1111-4111-8111-111111111111',
	categoryId: '33333333-3333-4333-8333-333333333333',
	kind: 'expense',
	source: { source: 'manual' },
	bookedOn: '2026-10-23',
	money: { amountMinor: 1200, currency: 'USD' },
	paymentMethod: 'check',
	check: {
		kind: 'new',
		values: { checkNumber: '101', checkDate: '2026-10-23' }
	}
}

describe('transaction save checkpoint contract', () => {
	it('accepts only retries in the original identity, workspace, binding, kind, and account', () => {
		const first = parseSaveRequest(values, undefined, scope)
		const checkpoint = {
			version: 1,
			scope,
			accountId: values.accountId,
			transactionId: '44444444-4444-4444-8444-444444444444',
			checkId: '55555555-5555-4555-8555-555555555555',
			checkIntent: 'new',
			checkSettlement: 'locallyPersisted',
			transactionSettlement: 'unknown',
			checkValues:
				values.paymentMethod === 'check'
					? {
							...values.check.values,
							organizationId: values.organizationId,
							accountId: values.accountId
						}
					: undefined,
			submitted: ledgerValues(values, '55555555-5555-4555-8555-555555555555')
		}
		expect(first.checkpoint).toBeUndefined()
		expect(parseSaveRequest(values, checkpoint, scope).checkpoint?.transactionId).toBe(
			checkpoint.transactionId
		)
		expect(() => parseSaveRequest(values, checkpoint, { ...scope, binding: {} })).toThrow(
			'Incompatible transaction recovery scope'
		)
		expect(() =>
			parseSaveRequest(
				{ ...values, accountId: '66666666-6666-4666-8666-666666666666' },
				checkpoint,
				scope
			)
		).toThrow('Incompatible transaction recovery scope')
	})

	it('pairs inline Check intent with the stable Check ID for the ledger write', () => {
		expect(ledgerValues(values, '55555555-5555-4555-8555-555555555555')).toMatchObject({
			paymentMethod: 'check',
			checkId: '55555555-5555-4555-8555-555555555555'
		})
	})
})
