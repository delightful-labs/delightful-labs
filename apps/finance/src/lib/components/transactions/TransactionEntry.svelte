<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import { getPageNavigation } from '../navigation/page-navigation.js'
	import { transactionPages, type TransactionKind } from '#lib/domain/transaction-kind.js'
	import PageLayout from '../navigation/PageLayout.svelte'
	import PageHeader from '../navigation/PageHeader.svelte'
	import WorkerTransactionEntry from '../worker/WorkerTransactionEntry.svelte'
	import WorkerAccountCreation from '../worker/WorkerAccountCreation.svelte'
	import { m } from '#lib/paraglide/messages.js'
	let { kind }: { kind: TransactionKind } = $props()
	const client = getFinanceWorker().client
	const state = fromStore(client.view)
	const navigation = getPageNavigation()
	const title = $derived(
		m['actions.add_subject']({
			subject: m[transactionPages[kind].noun]({ count: transactionPages[kind].count })
		})
	)
</script>

<svelte:head><title>{title} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader {title} />{/snippet}
	{#if state.current.transactionKind === kind}
		<WorkerTransactionEntry
			view={state.current}
			onsend={client.transactionEntryCommand}
			oncancel={() => client.navigateTransaction(null, state.current)}
		/>
		{#if state.current.transactionEntry?.form.readiness.kind === 'blocked' && state.current.transactionEntry.form.readiness.reason === 'noAccounts'}
			<WorkerAccountCreation view={state.current} onsend={client.accountCreationCommand} />
		{/if}
	{/if}
</PageLayout>
