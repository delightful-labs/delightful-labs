import type { TransactionRow } from '../schema.js'

export function groupTransactionsByDate(transactions: readonly TransactionRow[]) {
	const days = new Map<
		string,
		{ bookedOn: string; transactions: TransactionRow[]; totals: Map<string, number> }
	>()
	for (const transaction of transactions) {
		const day = days.get(transaction.bookedOn) ?? {
			bookedOn: transaction.bookedOn,
			transactions: [],
			totals: new Map<string, number>()
		}
		day.transactions.push(transaction)
		day.totals.set(
			transaction.currency,
			(day.totals.get(transaction.currency) ?? 0) + transaction.amountMinor
		)
		days.set(transaction.bookedOn, day)
	}
	return [...days.values()].sort((left, right) => right.bookedOn.localeCompare(left.bookedOn))
}

export type TransactionDay = ReturnType<typeof groupTransactionsByDate>[number]
