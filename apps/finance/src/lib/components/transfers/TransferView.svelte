<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import type { Snippet } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { page } from '$app/state'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import { withQueryParams } from '#lib/domain/query-params.js'
	import { Heading, StatusMessage } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '../navigation/PageHeader.svelte'
	import FloatingActionLink from '../navigation/FloatingActionLink.svelte'
	import TransferList from './TransferList.svelte'
	import SavedTransferForm from './SavedTransferForm.svelte'
	import TransactionWorkspace from '../transactions/TransactionWorkspace.svelte'
	import Message from '../shared/Message.svelte'
	let { children, navigation }: { children: Snippet; navigation: Snippet } = $props()
	const { client } = getFinanceWorker()
	const state = fromStore(client.view)
	const url = $derived(page.shallow?.url ?? page.url)
	const view = $derived(state.current.transfers)
	const heading = $derived(m['nouns.transfer']({ count: 2 }))
	const requestedPage = $derived(view?.requestedPage ?? 1)
	const listHref = $derived(
		withQueryParams('/transfers', { page: requestedPage > 1 ? requestedPage : null })
	)
	function transferHref(id: string) {
		return withQueryParams(`/transfers/${encodeURIComponent(id)}`, {
			page: requestedPage > 1 ? requestedPage : null
		})
	}
	function pageHref(number: number) {
		return withQueryParams(`${url.pathname}${url.search}`, {
			page: number > 1 ? number : null
		})
	}
	function onPage(number: number) {
		client.selectLedgerPage(number, {
			sessionRevision: state.current.sessionRevision,
			selection: state.current.selection
		})
	}
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
			{#if view?.selected}
				<SavedTransferForm
					expense={view.selected.expense}
					income={view.selected.income}
					accounts={view.accounts}
				/>
			{:else if view}
				<Message
					message={m['status.unavailable_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
				/>
			{:else}
				<StatusMessage
					variant={state.current.status === 'failed' ? 'error' : 'loading'}
					text={state.current.status === 'failed'
						? m['forms.load_failed']()
						: m['status.loading']()}
				/>
			{/if}
		</PageLayout>
	{/if}
	{@render children()}
	{#snippet list(showHeading, navigation, closeControl)}
		<PageLayout {navigation}>
			{#snippet pageHeading()}
				<div class="transfer-list-heading">
					<Heading level={showHeading ? 'h1' : 'h2'}>{heading}</Heading>{@render closeControl?.()}
				</div>
			{/snippet}
			{#if view}
				<TransferList {view} {pageHref} {transferHref} {onPage} />
			{:else}
				<StatusMessage
					variant={state.current.status === 'failed' ? 'error' : 'loading'}
					text={state.current.status === 'failed'
						? m['forms.load_failed']()
						: m['status.loading']()}
				/>
			{/if}
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
