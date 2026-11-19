import type { schema as s } from 'jazz-tools'
import { schema } from './schema.js'
const { definePermissions, exists, allOf, anyOf, ne } = schema
const validCheckReference = (checkId: s.Uuid, organizationId: s.Uuid, accountId: s.Uuid) =>
	anyOf(
		allOf(
			{ checkId: null },
			anyOf(
				{ paymentMethod: null },
				{ paymentMethod: 'cash' },
				{ paymentMethod: 'transfer' },
				{ paymentMethod: 'electronic' }
			)
		),
		allOf(
			{ paymentMethod: 'check', checkId: ne(null) },
			exists.checks({ id: checkId, organizationId, accountId })
		)
	)
const checkAccess = (accountId: s.Uuid, organizationId: s.Uuid) =>
	exists.accounts({ id: accountId, organizationId })
const transactionReferenceIsValid = (row: s.Row<typeof schema, 'transactions'>) =>
	allOf(
		checkAccess(row.accountId, row.organizationId),
		validCheckReference(row.checkId, row.organizationId, row.accountId)
	)
export const permissions = definePermissions({
	organizations: { read: true },
	accounts: { read: true },
	checks: {
		read: (row) => checkAccess(row.accountId, row.organizationId),
		insert: (row) => checkAccess(row.accountId, row.organizationId),
		updateIf: (row) => checkAccess(row.accountId, row.organizationId),
		updateTo: (row) =>
			allOf(
				checkAccess(row.accountId, row.organizationId),
				exists.checks({
					id: row.id,
					organizationId: row.organizationId,
					accountId: row.accountId
				})
			),
		delete: false
	},
	transactions: {
		read: (row) => checkAccess(row.accountId, row.organizationId),
		insert: transactionReferenceIsValid,
		updateIf: (row) => checkAccess(row.accountId, row.organizationId),
		updateTo: transactionReferenceIsValid,
		delete: false
	}
})
