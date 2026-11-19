<script lang="ts">
	import type { Snippet } from 'svelte'
	import TransactionListFilters from '../filters/TransactionListFilters.svelte'
	import type { TransactionListFilters as Filters } from '../../filters/transaction-list-filters.js'
	import type { FinanceWorkerView } from '../../contracts/worker-application.js'
	import { m } from '../../paraglide/messages.js'
	let {
		view,
		value,
		title,
		closeControl,
		onchange
	}: {
		view: FinanceWorkerView
		value?: Filters | undefined
		title?: string | undefined
		closeControl?: Snippet | undefined
		onchange: (change: Partial<Filters>) => void
	} = $props()
	const categories = $derived(
		new Map(
			view.ledger?.filterCategories.map(([id, name]) => [
				id,
				name ?? m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) })
			]) ?? []
		)
	)
</script>

{#if view.ledger}
	<TransactionListFilters
		{title}
		{closeControl}
		value={value ?? view.ledger.filters}
		{categories}
		currencies={view.ledger.currencies}
		{onchange}
	/>
{/if}
