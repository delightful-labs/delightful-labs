<script lang="ts">
	import { fromStore } from 'svelte/store'
	import type { Snippet } from 'svelte'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import type { TransactionKind } from '#lib/domain/transaction-kind.js'
	import PageLayout from '../navigation/PageLayout.svelte'
	import WorkerLedgerFilters from '../worker/WorkerLedgerFilters.svelte'
	import FloatingActionLink from '../navigation/FloatingActionLink.svelte'
	import WorkerLedger from '../worker/WorkerLedger.svelte'
	import WorkerAccountCreation from '../worker/WorkerAccountCreation.svelte'
	import { withQueryParams } from '#lib/domain/query-params.js'
	import { transactionListLocation } from '#lib/domain/transaction-list-routes.js'
	import { m } from '#lib/paraglide/messages.js'
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
	const client = getFinanceWorker().client
	const state = fromStore(client.view)
	const location = fromStore(client.location)
	const newHref = $derived(
		withQueryParams(`${listPath}/new`, {
			page:
				state.current.ledger && state.current.ledger.requestedPage > 1
					? state.current.ledger.requestedPage
					: null
		})
	)
</script>

<PageLayout {navigation}>
	{#snippet pageHeading()}
		<WorkerLedgerFilters
			view={state.current}
			value={transactionListLocation(location.current.search).filters}
			title={showHeading ? heading : m['nouns.transaction']({ count: 2 })}
			{closeControl}
			onchange={(change) => client.setLedgerFilters(change, state.current)}
		/>
	{/snippet}
	{#if state.current.transactionKind === kind}
		{#if state.current.status === 'ready' && state.current.accounts.length === 0}
			<p>{m['transactions.no_accounts']()}</p>
			<WorkerAccountCreation view={state.current} onsend={client.accountCreationCommand} />
		{/if}
		<WorkerLedger
			showFilters={false}
			view={state.current}
			filters={transactionListLocation(location.current.search).filters}
			onOpen={client.navigateTransaction}
			onPage={client.selectLedgerPage}
			onFilters={client.setLedgerFilters}
		/>
	{/if}
	<FloatingActionLink href={newHref} label={m['actions.add_subject']({ subject: heading })} />
</PageLayout>
