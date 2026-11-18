import {
	groupTransactionsByDate,
	paginateTransactionGroups
} from '../../domain/transaction-groups.js'
import {
	filterTransactions,
	type TransactionListFilters
} from '../../filters/transaction-list-filters.js'
import type { TransactionKind } from '../../domain/transaction-kind.js'
import type { WorkerLedgerView } from '../../contracts/worker-application.js'
import type { FinanceQueryFacts } from './worker-queries.js'

export const emptyLedgerFilters: TransactionListFilters = {
	start: '',
	end: '',
	categoryId: '',
	currency: '',
	query: ''
}

/** Pure worker projection. Only a selected page and presentation metadata leave the realm. */
export function selectWorkerLedger(
	facts: FinanceQueryFacts | undefined,
	kind: TransactionKind,
	filters: TransactionListFilters,
	requestedPage: number,
	selectedAccountIds: readonly string[] | null = null
): WorkerLedgerView | null {
	if (!facts || facts.status === 'failed' || !facts.transactions || !facts.categories) return null
	const categories = new Map(facts.categories.map((row) => [row.id, row.name]))
	const rows = facts.transactions.filter(
		(row) =>
			row.kind === kind &&
			(selectedAccountIds === null || selectedAccountIds.includes(row.accountId))
	)
	const tags = new Map(rows.map((row) => [row.id, row.tagNames]))
	const rangeValid = !filters.start || !filters.end || filters.start <= filters.end
	const selected = rangeValid ? filterTransactions(rows, filters, categories, tags) : []
	const page = paginateTransactionGroups(groupTransactionsByDate(selected), requestedPage)
	const visible = page.groups.flatMap((group) => group.transactions)
	return {
		filters,
		noAccountsSelected: selectedAccountIds?.length === 0,
		rangeValid,
		page: page.page,
		pageCount: page.pageCount,
		groups: page.groups.map((group) => ({
			bookedOn: group.bookedOn,
			totals: [...group.totals],
			transactions: group.transactions.map(
				({ id, bookedOn, amountMinor, currency, categoryId, description }) => ({
					id,
					bookedOn,
					amountMinor,
					currency,
					categoryId,
					description
				})
			)
		})),
		categories: [...new Set(visible.map((row) => row.categoryId))].flatMap((id) => {
			const name = categories.get(id)
			return name === undefined ? [] : [[id, name] satisfies [string, string]]
		}),
		tags: visible.map((row) => [row.id, row.tagNames]),
		filterCategories: [...new Set(rows.map((row) => row.categoryId))]
			.map<[string, string | null]>((id) => [id, categories.get(id) ?? null])
			.sort((left, right) => (left[1] ?? '').localeCompare(right[1] ?? '')),
		currencies: [...new Set(rows.map((row) => row.currency))].sort()
	}
}
