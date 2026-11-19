<script lang="ts">
	import { untrack } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { page } from '$app/state'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	import ExpenseOverview from '#lib/components/reports/ExpenseOverview.svelte'
	import {
		loadOverviewFilters,
		saveOverviewFilters,
		type OverviewFilters
	} from '#lib/filters/overview-filters.js'
	import type { TransactionListFilters } from '#lib/filters/transaction-list-filters.js'
	import { withQueryParams } from '#lib/domain/query-params.js'
	import { m } from '#lib/paraglide/messages.js'
	const client = getFinanceWorker().client
	const liveView = fromStore(client.view)
	const url = $derived(page.shallow?.url ?? page.url)
	const navigation = getPageNavigation()
	const preferenceKey = $derived(
		`finance-overview-filters:${liveView.current.selection.workspaceId ?? 'none'}`
	)
	let preference = $state<{ key: string; filters: OverviewFilters | null }>()
	$effect(() => {
		const key = preferenceKey
		untrack(() => (preference = { key, filters: loadOverviewFilters(key) }))
	})
	function change(filters: TransactionListFilters) {
		saveOverviewFilters(preferenceKey, {
			start: filters.start,
			end: filters.end,
			categoryId: filters.categoryId || null,
			currency: filters.currency
		})
		client.setOverviewFilters(filters, liveView.current)
	}
</script>

<svelte:head><title>{m['navigation.overview']()} · {m['app.name']()}</title></svelte:head>
{#if preference?.key === preferenceKey}
	{#key preferenceKey}
		<ExpenseOverview
			{navigation}
			data={liveView.current.overview}
			filters={preference.filters}
			scope={`${liveView.current.sessionRevision}:${liveView.current.selection.revision}`}
			onfilterschange={change}
			onPage={(number) => client.selectLedgerPage(number, liveView.current)}
			pageHref={(number) =>
				withQueryParams(`${url.pathname}${url.search}${url.hash}`, {
					page: number > 1 ? number : null
				})}
		/>
	{/key}
{/if}
