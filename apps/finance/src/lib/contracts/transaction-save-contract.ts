import { PAYMENT_METHOD } from '#lib/domain/payment-method.js'
import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
import { z } from 'zod'
import { appCheckSchema } from '../validation/checks.js'
import {
	independentTransactionSchema,
	transactionSaveSchema,
	type TransactionSaveValues
} from '../validation/transactions.js'
import type { IndependentTransaction } from '../domain/transaction.js'
import type { TransactionDetail } from '../schema.js'
import type { TransactionEntryScope } from './transaction-entry-contract.js'

const settlementSchema = z.enum([
	'notStarted',
	'locallyPersisted',
	'confirmed',
	'rejected',
	'unknown'
])
export const transactionCheckpointSchema = z.strictObject({
	version: z.literal(1),
	scope: z.strictObject({
		identityId: z.string().nullable(),
		organizationId: z.string().nullable(),
		binding: z.custom<object>((value) => typeof value === 'object' && value !== null),
		kind: z.enum([INCOME, EXPENSE]),
		transactionId: z.string().nullable().optional()
	}),
	accountId: z.uuid(),
	transactionId: z.uuid(),
	checkId: z.uuid().nullable(),
	checkIntent: z.enum(['none', 'new', 'existing']),
	checkSettlement: settlementSchema,
	transactionSettlement: settlementSchema,
	checkValues: appCheckSchema.optional(),
	submitted: independentTransactionSchema.optional()
})
export type TransactionCheckpoint = z.output<typeof transactionCheckpointSchema>
export function transferEditRequiresUnlink(
	transaction:
		| Pick<TransactionDetail, 'internalTransferId' | 'accountId' | 'amountMinor' | 'currency'>
		| null
		| undefined,
	values: Pick<TransactionSaveValues, 'accountId' | 'money'>,
	hasTransferRelation = false
) {
	return (
		(transaction?.internalTransferId != null || hasTransferRelation) &&
		transaction !== null &&
		transaction !== undefined &&
		(values.accountId !== transaction.accountId ||
			values.money.amountMinor !== transaction.amountMinor ||
			values.money.currency !== transaction.currency)
	)
}
export function sameSaveScope(
	a: Omit<TransactionEntryScope, 'transactionId'> & { transactionId?: string | null | undefined },
	b: TransactionEntryScope
) {
	return (
		a.binding === b.binding &&
		a.identityId === b.identityId &&
		a.organizationId === b.organizationId &&
		a.kind === b.kind &&
		a.transactionId === b.transactionId
	)
}
export function parseSaveRequest(
	values: unknown,
	checkpoint: unknown,
	scope: TransactionEntryScope
) {
	const parsed = transactionSaveSchema.parse(values)
	const recovery =
		checkpoint === undefined ? undefined : transactionCheckpointSchema.parse(checkpoint)
	if (
		recovery &&
		(!sameSaveScope(recovery.scope, scope) ||
			recovery.accountId !== parsed.accountId ||
			(recovery.checkIntent === 'existing' &&
				parsed.paymentMethod === PAYMENT_METHOD.CHECK &&
				parsed.check.kind === 'new') ||
			(parsed.paymentMethod === PAYMENT_METHOD.CHECK &&
				parsed.check.kind === 'existing' &&
				recovery.checkId !== null &&
				parsed.check.id !== recovery.checkId))
	) {
		throw new Error('Incompatible transaction recovery scope')
	}
	return { values: parsed, checkpoint: recovery }
}
export function ledgerValues(
	values: TransactionSaveValues,
	checkId: string | null
): IndependentTransaction {
	if (values.paymentMethod !== PAYMENT_METHOD.CHECK) return values
	const { check, ...base } = values
	void check
	return independentTransactionSchema.parse({ ...base, checkId })
}
export function desiredCheck(values: TransactionSaveValues) {
	if (values.paymentMethod !== PAYMENT_METHOD.CHECK || !values.check.values) return undefined
	return appCheckSchema.parse({
		...values.check.values,
		organizationId: values.organizationId,
		accountId: values.accountId
	})
}
