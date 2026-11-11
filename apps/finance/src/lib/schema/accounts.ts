import { schema as s } from 'jazz-tools'
import { appAccountSchema } from '../validation/accounts.js'
import { validatedTextColumn } from './text-column.js'

const nameColumn = validatedTextColumn(appAccountSchema.shape.name)
const currencyColumn = validatedTextColumn(appAccountSchema.shape.currency)
const accountTypes = appAccountSchema.shape.kind.enum

export const accountsSchema = {
	accounts: s.table(
		{
			organizationId: s.uuid(),
			name: nameColumn.column,
			kind: s.enum(accountTypes.cash, accountTypes.bank, accountTypes.card),
			currency: currencyColumn.column,
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
