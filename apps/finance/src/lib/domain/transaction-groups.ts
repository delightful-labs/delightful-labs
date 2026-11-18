import type { TransactionRow } from '../schema.js'

export type TransactionListRow = Pick<
	TransactionRow,
	'id' | 'bookedOn' | 'amountMinor' | 'currency' | 'categoryId' | 'description'
>
type GroupRow = Pick<TransactionRow, 'bookedOn' | 'amountMinor' | 'currency'>
export type TransactionDay<Row extends GroupRow = TransactionRow> = {
	bookedOn: string
	transactions: Row[]
	totals: ReadonlyMap<string, bigint>
}

export function groupTransactionsByDate<Row extends GroupRow>(
	transactions: readonly Row[]
): TransactionDay<Row>[] {
	const days = new Map<
		string,
		{ bookedOn: string; transactions: Row[]; totals: Map<string, bigint> }
	>()
	for (const transaction of transactions) {
		const day = days.get(transaction.bookedOn) ?? {
			bookedOn: transaction.bookedOn,
			transactions: [],
			totals: new Map<string, bigint>()
		}
		day.transactions.push(transaction)
		day.totals.set(
			transaction.currency,
			(day.totals.get(transaction.currency) ?? 0n) + BigInt(transaction.amountMinor)
		)
		days.set(transaction.bookedOn, day)
	}
	return [...days.values()].sort((left, right) => right.bookedOn.localeCompare(left.bookedOn))
}

/** Retain whole-day totals while bounding the rows rendered on a selected page. */
export function paginateTransactionGroups<Row extends GroupRow>(
	groups: readonly TransactionDay<Row>[],
	requestedPage: number
) {
	const pageSize = 25
	const count = groups.reduce((count, group) => count + group.transactions.length, 0)
	const pageCount = Math.max(1, Math.ceil(count / pageSize))
	const page = Math.min(requestedPage, pageCount)
	let offset = 0
	const start = (page - 1) * pageSize,
		end = start + pageSize
	const visible: TransactionDay<Row>[] = []
	for (const group of groups) {
		if (offset >= end) break
		const groupEnd = offset + group.transactions.length
		if (groupEnd > start)
			visible.push({
				...group,
				transactions: group.transactions.slice(Math.max(0, start - offset), end - offset)
			})
		offset = groupEnd
	}
	return { groups: visible, page, pageCount }
}
