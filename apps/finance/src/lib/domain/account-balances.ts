import { INCOME } from './transaction-kind.js'
import type { Account, TransactionRow } from '#lib/schema.js'

type BalanceTransaction = Pick<TransactionRow, 'accountId' | 'amountMinor' | 'currency' | 'kind'>

export function calculateAccountBalances(
	accounts: readonly Account[],
	transactions: readonly BalanceTransaction[]
): ReadonlyMap<string, bigint> {
	const balances = new Map(accounts.map((account) => [account.id, 0n]))
	const currencies = new Map(accounts.map((account) => [account.id, account.currency]))
	for (const transaction of transactions) {
		const balance = balances.get(transaction.accountId)
		if (balance === undefined || currencies.get(transaction.accountId) !== transaction.currency)
			continue
		const amount = BigInt(transaction.amountMinor)
		balances.set(transaction.accountId, balance + (transaction.kind === INCOME ? amount : -amount))
	}
	return balances
}
