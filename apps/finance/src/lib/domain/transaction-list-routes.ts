import { z } from 'zod'
import type { TransactionListFilters } from '../filters/transaction-list-filters.js'
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

/** List and detail links share the existing URL fields; page one has no page parameter. */
export function transactionListQuery(filters: TransactionListFilters, page: number) {
	return {
		start: filters.start || null,
		end: filters.end || null,
		category: filters.categoryId || null,
		currency: filters.currency || null,
		q: filters.query || null,
		page: page > 1 ? page : null
	}
}

export function transactionIdForPath(pathname: string): string | null {
	const parsed = z.uuid().safeParse(/^\/(?:expenses|income)\/([^/]+)$/.exec(pathname)?.[1])
	return parsed.success ? parsed.data : null
}
