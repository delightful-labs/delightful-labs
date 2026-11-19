import { schema as s } from 'jazz-tools'

const checkColumns = {
	organizationId: s.uuid(),
	accountId: s.uuid(),
	checkNumber: s.string().transform('checkNumber', s.string()),
	checkDate: s.string().transform('dateOnly', s.string()),
	payerName: s.string().optional(),
	bankName: s.string().optional(),
	memoOnCheck: s.string().optional()
}
const checkRelations = {
	organization: s.rel('organizations', 'organizationId'),
	account: s.rel('accounts', 'accountId'),
	transactions: s.reverse('transactions', 'check')
}

/** Shared by income and expense; direction belongs to the transaction. */
export const checksSchema = { checks: s.table(checkColumns, checkRelations) }

/** Compose these into the transaction schema together during adoption. */
export const transactionCheckColumns = { checkId: s.uuid().optional() }
export const transactionCheckRelations = { check: s.rel('checks', 'checkId') }
