<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'

	import { getContext, untrack, type Snippet } from 'svelte'
	import { createQuerySubscription } from 'delightful-local-first/backend/jazz/data'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { app } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/filters/finance-filters.js'
	import { resolveInternalTransferLinks } from '#lib/domain/internal-transfer.js'
	import { EXPENSE, INCOME } from '#lib/domain/transaction-kind.js'
	import { withQueryParams } from '#lib/domain/query-params.js'
	import { Heading } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from '../shared/QueryContent.svelte'
	import PageHeader from '../navigation/PageHeader.svelte'
	import FloatingActionLink from '../navigation/FloatingActionLink.svelte'
	import TransferList from './TransferList.svelte'
	import SavedTransferForm from './SavedTransferForm.svelte'
	import TransactionWorkspace from '../transactions/TransactionWorkspace.svelte'
	import Message from '../shared/Message.svelte'
	let { children, navigation }: { children: Snippet; navigation: Snippet } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const transactions = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.transactions.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const links = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.internalTransfers.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const accounts = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const accountNames = $derived(new Map((accounts.current ?? []).map((row) => [row.id, row.name])))
	const pairs = $derived.by(() => {
		const rows = transactions.current ?? []
		const byId = new Map(rows.map((row) => [row.id, row]))
		return resolveInternalTransferLinks(links.current ?? [], rows).effectiveLinks.flatMap(
			(link) => {
				const expense = byId.get(link.expenseTransactionId)
				const income = byId.get(link.incomeTransactionId)
				if (
					!expense ||
					!income ||
					expense.kind !== EXPENSE ||
					income.kind !== INCOME ||
					expense.accountId === income.accountId
				)
					return []
				if (!accountNames.has(expense.accountId) || !accountNames.has(income.accountId)) return []
				return [{ id: link.id, expense, income }]
			}
		)
	})
	const visiblePairs = $derived(
		pairs.filter(
			({ expense, income }) =>
				filters.selectedAccountIds === null ||
				filters.selectedAccountIds.includes(expense.accountId) ||
				filters.selectedAccountIds.includes(income.accountId)
		)
	)
	const selectedPair = $derived(pairs.find((pair) => pair.id === page.params.id))
	const heading = $derived(m['nouns.transfer']({ count: 2 }))
	const requestedPage = $derived.by(() => {
		const value = page.url.searchParams.get('page') ?? '1'
		const number = Number(value)
		return /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 ? number : 1
	})
	const listHref = $derived(
		withQueryParams('/transfers', { page: requestedPage > 1 ? requestedPage : null })
	)
	function transferHref(id: string) {
		return withQueryParams(`/transfers/${encodeURIComponent(id)}`, {
			page: requestedPage > 1 ? requestedPage : null
		})
	}

	function pageHref(number: number) {
		return withQueryParams(`${page.url.pathname}${page.url.search}`, {
			page: number > 1 ? number : null
		})
	}
	let previousScope: { organizationId: string | null; key: string } | undefined
	$effect(() => {
		const scope = {
			organizationId: filters.activeOrganizationId,
			key: JSON.stringify([filters.activeOrganizationId, filters.selectedAccountIds])
		}
		const previous = previousScope
		previousScope = scope
		if (previous?.organizationId && previous.key !== scope.key && requestedPage > 1)
			untrack(() => void goto(pageHref(1), { replace: true, reset: false }))
	})
</script>

<TransactionWorkspace
	{navigation}
	index={page.url.pathname === '/transfers'}
	{heading}
	listHref={page.params.id || page.url.pathname === '/transfers/new' ? listHref : undefined}
>
	{#if page.params.id}
		<PageLayout {navigation}>
			{#snippet pageHeading()}<PageHeader
					title={m['labels.subject_details']({ subject: m['nouns.transfer']({ count: 1 }) })}
				/>{/snippet}
			<QueryContent
				queries={[transactions, links, accounts]}
				loadingMessage={m['status.loading_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
				errorMessage={m['errors.load_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
			>
				{#if selectedPair}
					<SavedTransferForm
						expense={selectedPair.expense}
						income={selectedPair.income}
						accounts={accounts.current ?? []}
					/>
				{:else}
					<Message
						message={m['status.unavailable_subject']({
							subject: m['nouns.transfer']({ count: 1 })
						})}
					/>
				{/if}
			</QueryContent>
		</PageLayout>
	{/if}
	{@render children()}
	{#snippet list(showHeading, navigation, closeControl)}
		<PageLayout {navigation}>
			{#snippet pageHeading()}
				<div class="transfer-list-heading">
					<Heading level={showHeading ? 'h1' : 'h2'}>{heading}</Heading>
					{@render closeControl?.()}
				</div>
			{/snippet}
			<QueryContent
				queries={[transactions, links, accounts]}
				loadingMessage={m['status.loading_subject']({ subject: m['nouns.transfer']({ count: 2 }) })}
				errorMessage={m['errors.load_subject']({ subject: m['nouns.transfer']({ count: 2 }) })}
			>
				<TransferList
					pairs={visiblePairs}
					{accountNames}
					{requestedPage}
					{pageHref}
					{transferHref}
					noAccountsSelected={filters.selectedAccountIds !== null &&
						filters.selectedAccountIds.length === 0}
				/>
			</QueryContent>
			<FloatingActionLink
				href={withQueryParams('/transfers/new', { page: requestedPage > 1 ? requestedPage : null })}
				label={m['actions.add_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
			/>
		</PageLayout>
	{/snippet}
</TransactionWorkspace>

<style>
	.transfer-list-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--dui-spacing-md);
	}
</style>
