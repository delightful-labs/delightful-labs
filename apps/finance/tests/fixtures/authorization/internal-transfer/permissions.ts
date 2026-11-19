import type { schema as s } from 'jazz-tools'
import { schema } from './schema.js'
const { definePermissions, exists, allOf, anyOf, ne } = schema
const transferEndpointsMatch = (transfer: s.Row<typeof schema, 'internalTransfers'>) =>
	allOf(
		exists.transactions({
			id: transfer.expenseTransactionId,
			organizationId: transfer.organizationId,
			accountId: transfer.expenseAccountId,
			kind: 'expense',
			amountMinor: transfer.expenseAmountMinor,
			currency: transfer.expenseCurrency,
			internalTransferId: transfer.id
		}),
		exists.transactions({
			id: transfer.incomeTransactionId,
			organizationId: transfer.organizationId,
			accountId: transfer.incomeAccountId,
			kind: 'income',
			amountMinor: transfer.incomeAmountMinor,
			currency: transfer.incomeCurrency,
			internalTransferId: transfer.id
		})
	)
const transferEndpointsAreUnlinked = (transfer: s.Row<typeof schema, 'internalTransfers'>) =>
	allOf(
		exists.transactions({
			id: transfer.expenseTransactionId,
			organizationId: transfer.organizationId,
			accountId: transfer.expenseAccountId,
			internalTransferId: null
		}),
		exists.transactions({
			id: transfer.incomeTransactionId,
			organizationId: transfer.organizationId,
			accountId: transfer.incomeAccountId,
			internalTransferId: null
		})
	)
export const permissions = definePermissions({
	transactions: { read: true, insert: true, update: true },
	internalTransfers: {
		read: transferEndpointsMatch,
		insert: transferEndpointsMatch,
		delete: transferEndpointsAreUnlinked
	}
})
