<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import AccountList from '#lib/components/accounts/AccountList.svelte'
	import WorkerAccountCreation from '#lib/components/worker/WorkerAccountCreation.svelte'
	import { m } from '#lib/paraglide/messages.js'
	const client = getFinanceWorker().client
	const state = fromStore(client.view)
	const navigation = getPageNavigation()
	const balances = $derived(
		state.current.accounts.some((account) => account.balanceMinor === null)
			? null
			: new Map(state.current.accounts.map((account) => [account.id, account.balanceMinor ?? 0n]))
	)
</script>

<svelte:head><title>{m['nouns.account']({ count: 2 })} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['nouns.account']({ count: 2 })} />{/snippet}
	<WorkerAccountCreation view={state.current} onsend={client.accountCreationCommand} />
	{#if state.current.accountArchive && state.current.accountAccess}
		<AccountList
			view={state.current.accountArchive}
			{balances}
			onArchive={(id) => client.archiveAccount(id, state.current)}
			deleteGrantView={state.current.accountAccess}
			onDeleteGrant={(accountId, userId, canDelete) =>
				client.setAccountDeleteGrant(accountId, userId, canDelete, state.current)}
			grantQueries={[
				{
					isLoading: state.current.accountAccess.loading,
					error: state.current.accountAccess.failed ? true : null
				}
			]}
		/>
	{/if}
</PageLayout>
