import { z } from 'zod'
import {
	transactionLedgerRecordSchema,
	amountMinorValue,
	currencyText
} from '../validation/transactions.js'

export const workerTransferRecord = z.strictObject({
	id: z.uuid(),
	organizationId: z.uuid(),
	expenseTransactionId: z.uuid(),
	incomeTransactionId: z.uuid(),
	expenseAccountId: z.uuid().nullable(),
	incomeAccountId: z.uuid().nullable(),
	expenseAmountMinor: amountMinorValue.nullable(),
	incomeAmountMinor: amountMinorValue.nullable(),
	expenseCurrency: currencyText.nullable(),
	incomeCurrency: currencyText.nullable(),
	amountMinor: amountMinorValue.nullable(),
	currency: currencyText.nullable()
})
export type WorkerTransferRecord = z.output<typeof workerTransferRecord>
export const workerTransferPair = z.strictObject({
	id: z.uuid(),
	expense: transactionLedgerRecordSchema,
	income: transactionLedgerRecordSchema
})

/** Semantic presentation selected by the workflow; localized only by the UI. */
export const transferStatusMessage = z.enum([
	'loadingTransactions',
	'loadTransactionsFailed',
	'settling',
	'transferSaved',
	'cancelled',
	'saveTransferFailed',
	'recoveryRequired'
])
export type TransferStatusLabel = z.output<typeof transferStatusMessage>
export const transferDeleteFeedback = z.strictObject({
	message: z.enum([
		'settling',
		'deletedBoth',
		'deletedSelected',
		'recoveryRequired',
		'deleteFailed'
	]),
	variant: z.enum(['loading', 'success', 'error'])
})
export type TransferDeleteFeedback = z.output<typeof transferDeleteFeedback>
export type TransactionEditTransferState =
	'unselected' | 'searching' | 'matches' | 'empty' | 'failed' | 'linked' | 'conflicted'

export type WorkerTransferFacts = {
	rows: readonly WorkerTransferRecord[]
	transactions: readonly z.output<typeof transactionLedgerRecordSchema>[]
	loading: boolean
	failed: boolean
}
export const workerTransferEditCommand = z.discriminatedUnion('type', [
	z.strictObject({ type: z.enum(['ENABLE_SEARCH', 'DISABLE_SEARCH', 'UNLINK_TRANSFER']) }),
	z.strictObject({
		type: z.enum(['SELECT_COUNTERPART', 'LINK_COUNTERPART']),
		candidateId: z.uuid()
	}),
	z.strictObject({
		type: z.literal('DELETE_LINKED_TRANSFER'),
		choice: z.discriminatedUnion('kind', [
			z.strictObject({ kind: z.literal('both') }),
			z.strictObject({ kind: z.literal('selected'), transactionId: z.uuid() })
		])
	})
])
export type WorkerTransferEditCommand = z.output<typeof workerTransferEditCommand>
export const workerTransferEditView = z.strictObject({
	state: z.enum(['unselected', 'searching', 'matches', 'empty', 'failed', 'linked', 'conflicted']),
	searchEnabled: z.boolean(),
	conflict: z.boolean(),
	suggestions: z.array(
		transactionLedgerRecordSchema.extend({ accountName: z.string().optional() })
	),
	writableCandidateIds: z.array(z.uuid()),
	selectedCandidateId: z.uuid().nullable(),
	linkPending: z.boolean(),
	unlinkPending: z.boolean(),
	deletePending: z.boolean(),
	status: transferStatusMessage.nullable(),
	deleteFeedback: transferDeleteFeedback.nullable(),
	unlinkAvailable: z.boolean(),
	unlinkWritable: z.boolean(),
	deleteAvailable: z.boolean(),
	linkedCounterpartHref: z.string().nullable()
})
export type WorkerTransferEditView = z.output<typeof workerTransferEditView>
