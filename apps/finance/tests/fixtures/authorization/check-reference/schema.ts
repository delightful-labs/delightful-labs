import { schema as s } from 'jazz-tools'
import {
	checksSchema,
	transactionCheckColumns,
	transactionCheckRelations
} from '#lib/schema/checks.js'
export const schema = s.defineSchema({
	organizations: s.table({ name: s.string() }, {}),
	accounts: s.table(
		{ organizationId: s.uuid() },
		{ organization: s.rel('organizations', 'organizationId') }
	),
	...checksSchema,
	transactions: s.table(
		{
			organizationId: s.uuid(),
			accountId: s.uuid(),
			kind: s.enum('income', 'expense'),
			paymentMethod: s.enum('cash', 'check', 'transfer', 'electronic').optional(),
			...transactionCheckColumns
		},
		{
			...transactionCheckRelations,
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	)
})
