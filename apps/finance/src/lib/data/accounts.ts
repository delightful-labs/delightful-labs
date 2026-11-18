import type { Db } from 'jazz-tools'
import { app, type Account } from '../schema.js'
import { ACCOUNT_CURRENCY, type AccountCurrency } from '../domain/account-currency.js'
import { appAccountSchema } from '../validation/accounts.js'

export function createAccount(
	db: Pick<Db, 'insert'>,
	organizationId: string,
	name: string,
	kind: Account['kind'],
	currency: AccountCurrency = ACCOUNT_CURRENCY.USD
) {
	const account = appAccountSchema.parse({ organizationId, name, kind, currency })
	return db.insert(app.accounts, account).wait({ tier: 'local' })
}

export function archiveAccount(db: Pick<Db, 'update'>, accountId: Account['id']) {
	return db.update(app.accounts, accountId, { archivedAt: new Date() }).wait({ tier: 'local' })
}
