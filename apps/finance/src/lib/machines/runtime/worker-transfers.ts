import { resolveInternalTransferLinks } from '../../domain/internal-transfer.js'
import {
	groupTransactionsByDate,
	paginateTransactionGroups
} from '../../domain/transaction-groups.js'
import { EXPENSE, INCOME } from '../../domain/transaction-kind.js'
import type { FinanceQueryFacts } from './worker-queries.js'
import type { WorkerTransferListView } from '../../contracts/worker-application.js'

/** Publish only the visible transfer page and the requested detail. */
export function selectWorkerTransfers(
	facts: FinanceQueryFacts | undefined,
	requestedPage: number,
	selectedAccountIds: readonly string[] | null,
	selectedId: string | null
): WorkerTransferListView | null {
	if (
		!facts ||
		facts.status === 'failed' ||
		!facts.transactions ||
		!facts.transfers ||
		!facts.accounts
	)
		return null
	const byId = new Map(facts.transactions.map((row) => [row.id, row]))
	const accounts = new Map(facts.accounts.map((row) => [row.id, row]))
	const pairs = resolveInternalTransferLinks(
		facts.transfers,
		facts.transactions
	).effectiveLinks.flatMap((link) => {
		const expense = byId.get(link.expenseTransactionId),
			income = byId.get(link.incomeTransactionId)
		return expense &&
			income &&
			expense.kind === EXPENSE &&
			income.kind === INCOME &&
			expense.accountId !== income.accountId &&
			accounts.has(expense.accountId) &&
			accounts.has(income.accountId)
			? [{ id: link.id, expense, income }]
			: []
	})
	const visible = pairs.filter(
		({ expense, income }) =>
			selectedAccountIds === null ||
			selectedAccountIds.includes(expense.accountId) ||
			selectedAccountIds.includes(income.accountId)
	)
	const page = paginateTransactionGroups(
		groupTransactionsByDate(visible.map((pair) => pair.expense)),
		requestedPage
	)
	const ids = new Set(page.groups.flatMap((group) => group.transactions.map((row) => row.id)))
	const selected = pairs.find((pair) => pair.id === selectedId) ?? null
	const published = visible.filter((pair) => ids.has(pair.expense.id))
	const accountIds = new Set(
		[...published, ...(selected ? [selected] : [])].flatMap((pair) => [
			pair.expense.accountId,
			pair.income.accountId
		])
	)
	return {
		page: page.page,
		pageCount: page.pageCount,
		requestedPage,
		noAccountsSelected: selectedAccountIds?.length === 0,
		groups: page.groups.map((group) => ({
			bookedOn: group.bookedOn,
			transactions: group.transactions,
			totals: [...group.totals]
		})),
		pairs: published,
		selected,
		accounts: facts.accounts
			.filter((account) => accountIds.has(account.id))
			.map(({ id, name, kind, currency }) => ({ id, name, kind, currency }))
	}
}
