<script lang="ts">
	import { StatusMessage } from 'delightful-ui'
	import TransactionListView from '../transactions/TransactionListView.svelte'
	import TransactionListFilters from '../filters/TransactionListFilters.svelte'
	import type { TransactionListFilters as Filters } from '../../filters/transaction-list-filters.js'
	import type { FinanceWorkerView, WorkerCommandScope } from '../../contracts/worker-application.js'
	import { transactionPages } from '../../domain/transaction-kind.js'
	import { workspaceHref } from '../../domain/workspace-routes.js'
	import { withQueryParams } from '../../domain/query-params.js'
	import { m } from '../../paraglide/messages.js'
	let {
		view,
		onPage,
		onFilters
	}: {
		view: FinanceWorkerView
		onPage: (page: number, scope: WorkerCommandScope) => void
		onFilters: (filters: Filters, scope: WorkerCommandScope) => void
	} = $props()
	const groups = $derived(
		view.ledger?.groups.map((group) => ({ ...group, totals: new Map(group.totals) })) ?? []
	)
	const categoryNames = $derived(new Map(view.ledger?.categories ?? []))
	const tagNames = $derived(new Map(view.ledger?.tags ?? []))
	const filterCategories = $derived(
		new Map(
			view.ledger?.filterCategories.map(([id, name]) => [
				id,
				name ?? m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) })
			]) ?? []
		)
	)
	const scope = $derived({ sessionRevision: view.sessionRevision, selection: view.selection })
	function pageHref(page: number) {
		return withQueryParams(
			workspaceHref(view.selection.workspaceId, transactionPages[view.transactionKind].path),
			{ page }
		)
	}
</script>

{#if view.ledger}
	<TransactionListFilters
		value={view.ledger.filters}
		categories={filterCategories}
		currencies={view.ledger.currencies}
		onchange={(filters) => onFilters(filters, scope)}
	/>
	{#if !view.ledger.rangeValid}
		<p role="status">{m['errors.date_range_invalid']()}</p>
	{:else}
		<TransactionListView
			{groups}
			{categoryNames}
			tagNamesByTransaction={tagNames}
			noAccountsSelected={false}
			page={view.ledger.page}
			pageCount={view.ledger.pageCount}
			{pageHref}
			transactionHref={(id) =>
				workspaceHref(
					view.selection.workspaceId,
					`${transactionPages[view.transactionKind].path}/${encodeURIComponent(id)}`
				)}
			onPage={(page) => onPage(page, scope)}
		/>
	{/if}
{:else if view.status === 'ready' && view.selection.workspaceId}
	<StatusMessage
		variant="loading"
		text={m['status.loading_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
	/>
{/if}
