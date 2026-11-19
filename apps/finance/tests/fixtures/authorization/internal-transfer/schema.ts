import { schema as s } from 'jazz-tools'
export const schema = s.defineSchema({
	transactions: s.table(
		{
			organizationId: s.uuid(),
			accountId: s.uuid(),
			kind: s.enum('expense', 'income'),
			amountMinor: s.string(),
			currency: s.string(),
			internalTransferId: s.uuid().optional()
		},
		{}
	),
	internalTransfers: s.table(
		{
			organizationId: s.uuid(),
			expenseTransactionId: s.uuid(),
			incomeTransactionId: s.uuid(),
			expenseAccountId: s.uuid(),
			incomeAccountId: s.uuid(),
			expenseAmountMinor: s.string().optional(),
			expenseCurrency: s.string().optional(),
			incomeAmountMinor: s.string().optional(),
			incomeCurrency: s.string().optional(),
			amountMinor: s.string(),
			currency: s.string()
		},
		{
			expenseTransaction: s.rel('transactions', 'expenseTransactionId'),
			incomeTransaction: s.rel('transactions', 'incomeTransactionId')
		}
	)
})
