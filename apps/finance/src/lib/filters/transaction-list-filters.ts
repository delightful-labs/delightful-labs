import type { TransactionRow } from '#lib/schema.js'

export type TransactionListFilters = {
	start: string
	end: string
	categoryId: string
	currency: string
	query: string
}

export function filterTransactions(
	transactions: readonly TransactionRow[],
	filters: TransactionListFilters,
	categoryNames: ReadonlyMap<string, string>,
	tagNames: ReadonlyMap<string, readonly string[]>
) {
	const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
	return transactions.filter((row) => {
		if (filters.start && row.bookedOn < filters.start) return false
		if (filters.end && row.bookedOn > filters.end) return false
		if (filters.categoryId && row.categoryId !== filters.categoryId) return false
		if (filters.currency && row.currency !== filters.currency) return false
		const text = [
			row.description,
			row.memo,
			categoryNames.get(row.categoryId),
			...(tagNames.get(row.id) ?? [])
		]
			.join(' ')
			.toLowerCase()
		return terms.every((term) => text.includes(term))
	})
}
