<script lang="ts">
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()
	import { EXPENSE } from '#lib/domain/transaction-kind.js'
	import { resolveInternalTransferLinks } from '#lib/domain/internal-transfer.js'
	import { transactionTagNames } from '#lib/domain/transaction-tags.js'
	import { getContext, onMount } from 'svelte'
	import { createQuerySubscription } from 'delightful-local-first/backend/jazz/data'
	import { app } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/filters/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from '#lib/components/shared/QueryContent.svelte'
	import ExpenseOverview from '#lib/components/reports/ExpenseOverview.svelte'
	import { browser } from '$app/env'
	import {
		loadOverviewFilters,
		saveOverviewFilters,
		type OverviewFilters
	} from '#lib/filters/overview-filters.js'
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const overviewFiltersKey = $derived(
		`finance-overview-filters:${filters.activeOrganizationId ?? 'none'}`
	)
	let overviewFilters = $state<OverviewFilters | null>(null)
	onMount(() => {
		overviewFilters = loadOverviewFilters(overviewFiltersKey)
	})
	$effect(() => {
		if (browser) saveOverviewFilters(overviewFiltersKey, overviewFilters)
	})
	const transactions = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.transactions
					.where({ organizationId: filters.activeOrganizationId })
					.orderBy('bookedOn', 'desc')
			: undefined
	)
	const categories = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const tags = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const links = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.transactionTags.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const transfers = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.internalTransfers.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const transferResolution = $derived(
		resolveInternalTransferLinks(transfers.current ?? [], transactions.current ?? [])
	)
	const visibleTransactions = $derived(
		(transactions.current ?? []).filter(
			(transaction) =>
				transaction.kind === EXPENSE &&
				(filters.selectedAccountIds === null ||
					filters.selectedAccountIds.includes(transaction.accountId))
		)
	)
	const categoryNames = $derived(
		new Map((categories.current ?? []).map((row) => [row.id, row.name]))
	)
	const tagNamesByTransaction = $derived(
		transactionTagNames(tags.current ?? [], links.current ?? [])
	)
</script>

<svelte:head><title>{m['navigation.overview']()} · {m['app.name']()}</title></svelte:head>
<QueryContent
	queries={[transactions, categories, tags, links, transfers]}
	loadingMessage={m['status.loading_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
	errorMessage={m['errors.load_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
>
	{#key JSON.stringify([filters.activeOrganizationId, filters.selectedAccountIds])}
		<ExpenseOverview
			{navigation}
			transactions={visibleTransactions}
			{categoryNames}
			{tagNamesByTransaction}
			internalTransferResolution={transferResolution}
			filters={overviewFilters}
			onfilterschange={(value) => (overviewFilters = value)}
		/>
	{/key}
</QueryContent>
