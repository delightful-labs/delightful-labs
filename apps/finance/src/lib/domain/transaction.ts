import type { z } from 'zod'
import type { TransactionRow } from '../schema.js'
import {
	appTransactionSchema,
	independentTransactionSchema,
	transactionSchemaFor
} from '../validation/transactions.js'

export type IncomePaymentMethod = NonNullable<TransactionRow['paymentMethod']>

export type IndependentTransaction = z.output<typeof independentTransactionSchema>

export type AppTransaction = z.output<typeof appTransactionSchema>
export type TransactionValidationError =
	| 'amount'
	| 'currency'
	| 'booked-on'
	| 'check-number'
	| 'check-date'
	| 'source-id'
	| 'invalid-transaction'

const validationErrorByPath: Readonly<Record<string, TransactionValidationError>> = {
	'money.amountMinor': 'amount',
	'money.currency': 'currency',
	bookedOn: 'booked-on',
	'check.values.checkNumber': 'check-number',
	'check.values.checkDate': 'check-date',
	'source.externalId': 'source-id'
}

export function validateTransaction(
	transaction: AppTransaction
): TransactionValidationError | null {
	if (appTransactionSchema.safeParse(transaction).success) return null
	const result = transactionSchemaFor(transaction).safeParse(transaction)
	if (result.success) return null

	const path = result.error.issues[0]?.path.join('.')
	return (path && validationErrorByPath[path]) || 'invalid-transaction'
}
