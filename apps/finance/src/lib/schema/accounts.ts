import { schema as s } from 'jazz-tools'
import { appAccountSchema } from '../validation/accounts.js'

const accountTypes = appAccountSchema.shape.kind.enum

export const accountsSchema = {
	accounts: s.table(
		{
			organizationId: s.uuid(),
			name: s.string().transform('accountName', s.string()),
			kind: s.enum(accountTypes.cash, accountTypes.bank, accountTypes.card),
			currency: s.string().transform('accountCurrency', s.string()),
			archivedAt: s.timestamp().optional()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			transactions: s.reverse('transactions', 'account'),
			memberships: s.reverse('accountMemberships', 'account')
		}
	),
	accountMemberships: s.table(
		{
			organizationId: s.uuid(),
			userId: s.uuid(),
			accountId: s.uuid(),
			access: s.enum('read', 'write'),
			canDelete: s.boolean()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	)
}
