<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { createLogger } from '#lib/diagnostics/logger.js'
	import { safeBankError } from '#lib/integrations/diagnostics.js'

	const logger = createLogger('Jazz transaction view')
	import { transactionTagNames } from '#lib/domain/transaction-tags.js'
	import type { TransactionKind } from '#lib/domain/transaction-kind.js'
	import { groupTransactionsByDate } from '#lib/domain/transaction-groups.js'
	import { withQueryParams } from '#lib/domain/query-params.js'
	import { app } from '#lib/schema.js'
	import { createQuerySubscription } from 'delightful-local-first/backend/jazz/data'
	import { getContext, untrack, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import { replaceState } from '$app/navigation'
	import { financeFiltersKey, type FinanceFilters } from '#lib/filters/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountCreation from '#lib/components/accounts/AccountCreation.svelte'
	import Message from '#lib/components/shared/Message.svelte'
	import TransactionList from '#lib/components/transactions/TransactionList.svelte'
	import QueryContent from '#lib/components/shared/QueryContent.svelte'
	import FloatingActionLink from '../navigation/FloatingActionLink.svelte'
	import TransactionListFilters from '../filters/TransactionListFilters.svelte'
	import {
		filterTransactions,
		type TransactionListFilters as ListFilters
	} from '#lib/filters/transaction-list-filters.js'

	let {
		navigation,
		kind,
		heading,
		listPath,
		closeControl,
		showHeading = true
	}: {
		navigation: Snippet
		kind: TransactionKind
		heading: string
		listPath: string
		closeControl?: Snippet | undefined
		showHeading?: boolean
	} = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const currentUrl = $derived(page.shallow?.url ?? page.url)
	const listFilters = $derived<ListFilters>({
		start: currentUrl.searchParams.get('start') ?? '',
		end: currentUrl.searchParams.get('end') ?? '',
		categoryId: currentUrl.searchParams.get('category') ?? '',
		currency: currentUrl.searchParams.get('currency') ?? '',
		query: currentUrl.searchParams.get('q') ?? ''
	})
	function changeListFilters(value: ListFilters) {
		replaceState(
			withQueryParams(`${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`, {
				start: value.start || null,
				end: value.end || null,
				category: value.categoryId || null,
				currency: value.currency || null,
				q: value.query || null,
				page: null
			}),
			page.state
		)
	}
	const validRange = $derived(
		!listFilters.start || !listFilters.end || listFilters.start <= listFilters.end
	)

	const requestedPage = $derived.by(() => {
		const value = currentUrl.searchParams.get('page') ?? '1'
		const number = Number(value)
		return /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 ? number : 1
	})
	function pageHref(number: number) {
		return withQueryParams(`${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`, {
			page: number > 1 ? number : null
		})
	}
	function transactionHref(id: string) {
		return withQueryParams(`${listPath}/${encodeURIComponent(id)}`, {
			start: listFilters.start || null,
			end: listFilters.end || null,
			category: listFilters.categoryId || null,
			currency: listFilters.currency || null,
			q: listFilters.query || null,
			page: requestedPage > 1 ? requestedPage : null
		})
	}
	const newHref = $derived(
		withQueryParams(`${listPath}/new`, {
			page: requestedPage > 1 ? requestedPage : null
		})
	)

	let previousPaginationScope:
		{ organizationId: string | null; pathname: string; key: string } | undefined
	$effect(() => {
		const scope = {
			organizationId: filters.activeOrganizationId,
			pathname: currentUrl.pathname,
			key: JSON.stringify([filters.activeOrganizationId, kind, filters.selectedAccountIds])
		}
		const previous = previousPaginationScope
		previousPaginationScope = scope
		// Preserve a direct page link while the initial workspace is loading.
		if (
			previous?.organizationId &&
			previous.pathname === scope.pathname &&
			previous.key !== scope.key
		) {
			untrack(() => replaceState(pageHref(1), page.state))
		}
	})

	const transactions = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.transactions
					.where({ organizationId: filters.activeOrganizationId, kind })
					.orderBy('bookedOn', 'desc')
			: undefined
	)
	const visibleTransactions = $derived(
		(transactions.current ?? []).filter(
			(transaction) =>
				filters.selectedAccountIds === null ||
				filters.selectedAccountIds.includes(transaction.accountId)
		)
	)
	const accounts = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts.where({ organizationId: filters.activeOrganizationId })
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
	const reportedQueryErrors = new WeakSet<Error>()
	$effect(() => {
		const queries = { transactions, accounts, categories, tags, transactionTags: links }
		for (const [query, subscription] of Object.entries(queries)) {
			const error = subscription.error
			if (!error || reportedQueryErrors.has(error)) continue
			reportedQueryErrors.add(error)
			// Log error details only, never query parameters or finance records.
			logger.error('Query failed', {
				query,
				kind,
				...safeBankError(error)
			})
		}
	})
	const categoryNames = $derived(
		new Map((categories.current ?? []).map((row) => [row.id, row.name]))
	)
	const tagNamesByTransaction = $derived(
		transactionTagNames(tags.current ?? [], links.current ?? [])
	)
	const groups = $derived(
		groupTransactionsByDate(
			filterTransactions(visibleTransactions, listFilters, categoryNames, tagNamesByTransaction)
		)
	)
	const filterCategories = $derived(
		new Map(
			[...new Set(visibleTransactions.map((row) => row.categoryId))]
				.map<[string, string]>((id) => [
					id,
					categoryNames.get(id) ??
						m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) })
				])
				.sort((left, right) => (left[1] ?? '').localeCompare(right[1] ?? ''))
		)
	)
	const currencies = $derived([...new Set(visibleTransactions.map((row) => row.currency))].sort())
</script>

<PageLayout {navigation}>
	{#snippet pageHeading()}
		{#key JSON.stringify([filters.activeOrganizationId, kind, filters.selectedAccountIds])}
			<TransactionListFilters
				{closeControl}
				title={showHeading ? heading : m['nouns.transaction']({ count: 2 })}
				headingLevel={showHeading ? 'h1' : 'h2'}
				value={listFilters}
				categories={filterCategories}
				{currencies}
				onchange={changeListFilters}
			/>
		{/key}
	{/snippet}
	<QueryContent
		queries={[transactions, accounts, categories, tags, links]}
		loadingMessage={m['status.loading_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
		errorMessage={m['errors.load_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
	>
		{#if (accounts.current ?? []).filter((account) => !account.archivedAt).length === 0}
			<Message message={m['transactions.no_accounts']()} />
			<AccountCreation />
		{/if}
		{#key JSON.stringify([filters.activeOrganizationId, kind, filters.selectedAccountIds])}
			{#if !validRange}
				<Message message={m['errors.date_range_invalid']()} />
			{:else}
				<TransactionList
					{groups}
					{requestedPage}
					{pageHref}
					{transactionHref}
					{categoryNames}
					{tagNamesByTransaction}
					noAccountsSelected={filters.selectedAccountIds !== null &&
						filters.selectedAccountIds.length === 0}
				/>
			{/if}
		{/key}
	</QueryContent>

	<FloatingActionLink
		href={newHref}
		label={m['actions.add_subject']({
			subject: heading
		})}
	/>
</PageLayout>
