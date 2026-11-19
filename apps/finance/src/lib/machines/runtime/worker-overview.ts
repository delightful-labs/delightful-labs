import { EXPENSE } from '../../domain/transaction-kind.js'
import { resolveInternalTransferLinks } from '../../domain/internal-transfer.js'
import {
	filterTransactions,
	type TransactionListFilters
} from '../../filters/transaction-list-filters.js'
import {
	groupTransactionsByDate,
	paginateTransactionGroups
} from '../../domain/transaction-groups.js'
import type { FinanceQueryFacts } from './worker-queries.js'
import type { WorkerOverviewView } from '../../contracts/worker-application.js'

/** Full-history totals stay in the Worker; only one render page leaves it. */
export function selectWorkerOverview(
	facts: FinanceQueryFacts | undefined,
	filters: TransactionListFilters | undefined,
	requestedPage: number,
	selectedAccounts: readonly string[] | null
): WorkerOverviewView | null {
	if (
		!facts ||
		facts.status === 'failed' ||
		!facts.transactions ||
		!facts.categories ||
		!facts.transfers ||
		!filters
	)
		return null
	const names = new Map(facts.categories.map((row) => [row.id, row.name]))
	const suppressed = resolveInternalTransferLinks(
		facts.transfers,
		facts.transactions
	).suppressedTransactionIds
	const rows = facts.transactions.filter(
		(row) =>
			row.kind === EXPENSE &&
			!suppressed.has(row.id) &&
			(selectedAccounts === null || selectedAccounts.includes(row.accountId))
	)
	const tags = new Map(rows.map((row) => [row.id, row.tagNames]))
	const searched = filterTransactions(
		rows,
		{ query: filters.query, start: '', end: '', categoryId: '', currency: '' },
		names,
		tags
	)
	const rangeValid = !!filters.start && !!filters.end && filters.start <= filters.end
	const period = rangeValid
		? searched.filter((row) => row.bookedOn >= filters.start && row.bookedOn <= filters.end)
		: []
	const currencies = [...new Set(period.map((row) => row.currency))].sort()
	const currency = currencies.includes(filters.currency)
		? filters.currency
		: (currencies[0] ?? 'USD')
	const expenses = period.filter((row) => row.currency === currency)
	const totals = new Map<string, bigint>()
	for (const row of expenses)
		totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0n) + BigInt(row.amountMinor))
	const slices = [...totals]
		.map(([key, value]) => ({ key, value, name: names.get(key) ?? null }))
		.sort((a, b) => (a.value === b.value ? a.key.localeCompare(b.key) : a.value > b.value ? -1 : 1))
	const activeCategory = totals.has(filters.categoryId) ? filters.categoryId : null
	const visible = expenses.filter(
		(row) => activeCategory === null || row.categoryId === activeCategory
	)
	const page = paginateTransactionGroups(groupTransactionsByDate(visible), requestedPage)
	const rendered = page.groups.flatMap((group) => group.transactions)
	return {
		rangeValid,
		currencies,
		currency,
		slices,
		activeCategory,
		hasExpenses: expenses.length > 0,
		categoryIds: [...new Set(searched.map((row) => row.categoryId))].sort(),
		categories: [...names],
		tags: rendered.map((row) => [row.id, row.tagNames]),
		total: slices.reduce((sum, row) => sum + row.value, 0n),
		page: page.page,
		pageCount: page.pageCount,
		requestedPage,
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
		}))
	}
}
