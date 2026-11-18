import type { TransactionRow } from '#lib/schema.js'

export type TransactionListFilters = {
	start: string
	end: string
	categoryId: string
	currency: string
	query: string
}

/** Shared URL semantics for the legacy integration and worker-owned list. */
export function transactionListLocation(search: string) {
	const params = new URLSearchParams(search),
		value = params.get('page') ?? '1',
		number = Number(value)
	return {
		filters: {
			start: params.get('start') ?? '',
			end: params.get('end') ?? '',
			categoryId: params.get('category') ?? '',
			currency: params.get('currency') ?? '',
			query: params.get('q') ?? ''
		},
		requestedPage: /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 ? number : 1
	}
}

export function filterTransactions<
	Row extends Pick<
		TransactionRow,
		'bookedOn' | 'categoryId' | 'currency' | 'description' | 'memo' | 'id'
	>
>(
	transactions: readonly Row[],
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
