import { TRANSACTION_SOURCE } from '#lib/domain/transaction-source.js'
import { PAYMENT_METHOD } from '#lib/domain/payment-method.js'
import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
import { schema as s } from 'jazz-tools'
import {
	amountMinorValue,
	checkNumberText,
	currencyText,
	dateOnlyText,
	externalIdText
} from '../validation/transactions.js'
import { validatedTextColumn } from './text-column.js'
import { transactionCheckColumns, transactionCheckRelations } from './checks.js'

const currencyColumn = () => validatedTextColumn(currencyText).column
const bookedOnColumn = validatedTextColumn(dateOnlyText)
const checkDateColumn = validatedTextColumn(dateOnlyText)
const checkNumberColumn = validatedTextColumn(checkNumberText)
const externalIdColumn = validatedTextColumn(externalIdText)
const amountMinorColumn = () =>
	s.bigint().transform<number>({
		from: (value) => amountMinorValue.parse(Number(value)),
		to: (value) => BigInt(amountMinorValue.parse(value))
	})

export const transactionsSchema = {
	transactions: s.table(
		{
			amountMinor: amountMinorColumn(),
			kind: s.enum(EXPENSE, INCOME),
			currency: currencyColumn(),
			categoryId: s.uuid(),
			accountId: s.uuid(),
			organizationId: s.uuid(),
			// ISO 8601 calendar date (YYYY-MM-DD), not a timestamp.
			bookedOn: bookedOnColumn.column,
			description: s.string().optional(),
			memo: s.string().optional(),
			paymentMethod: s
				.enum(
					PAYMENT_METHOD.CASH,
					PAYMENT_METHOD.CHECK,
					PAYMENT_METHOD.TRANSFER,
					PAYMENT_METHOD.ELECTRONIC
				)
				.optional(),
			checkDetailsId: s.uuid().optional(),
			...transactionCheckColumns,
			internalTransferId: s.uuid().optional(),
			source: s.enum(TRANSACTION_SOURCE.MANUAL, TRANSACTION_SOURCE.SIMPLEFIN),
			externalId: externalIdColumn.column.optional(),
			batchId: s.uuid().optional()
		},
		{
			account: s.rel('accounts', 'accountId'),
			category: s.rel('categories', 'categoryId'),
			organization: s.rel('organizations', 'organizationId'),
			batch: s.rel('transactionBatches', 'batchId'),
			tags: s.reverse('transactionTags', 'transaction'),
			checkDetails: s.rel('checkDetails', 'checkDetailsId'),
			internalTransfer: s.rel('internalTransfers', 'internalTransferId'),
			...transactionCheckRelations,
			attachments: s.reverse('transactionAttachments', 'transaction')
		}
	),
	transactionTags: s.table(
		{
			organizationId: s.uuid(),
			transactionId: s.uuid(),
			tagId: s.uuid()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			transaction: s.rel('transactions', 'transactionId'),
			tag: s.rel('tags', 'tagId')
		}
	),
	checkDetails: s.table(
		{
			transactionId: s.uuid(),
			organizationId: s.uuid(),
			accountId: s.uuid(),
			checkNumber: checkNumberColumn.column,
			checkDate: checkDateColumn.column,
			payerName: s.string().optional(),
			bankName: s.string().optional(),
			memoOnCheck: s.string().optional()
		},
		{
			transaction: s.rel('transactions', 'transactionId'),
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	),
	internalTransfers: s.table(
		{
			organizationId: s.uuid(),
			expenseTransactionId: s.uuid(),
			incomeTransactionId: s.uuid(),
			expenseAccountId: s.uuid().optional(),
			incomeAccountId: s.uuid().optional(),
			expenseAmountMinor: amountMinorColumn().optional(),
			expenseCurrency: currencyColumn().optional(),
			incomeAmountMinor: amountMinorColumn().optional(),
			incomeCurrency: currencyColumn().optional(),
			amountMinor: amountMinorColumn().optional(),
			currency: currencyColumn().optional()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			expenseTransaction: s.rel('transactions', 'expenseTransactionId'),
			incomeTransaction: s.rel('transactions', 'incomeTransactionId'),
			expenseAccount: s.rel('accounts', 'expenseAccountId'),
			incomeAccount: s.rel('accounts', 'incomeAccountId')
		}
	)
}
