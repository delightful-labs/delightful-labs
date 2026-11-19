<script lang="ts">
	import 'delightful-ui/theme.css'
	import { fromStore } from 'svelte/store'
	import WorkerAccounts from '../../src/lib/components/worker/WorkerAccounts.svelte'
	import {
		setFinanceWorker,
		type FinanceWorkerClient
	} from '../../src/lib/runtime/worker/context.js'
	import Accounts from '../../src/routes/accounts/+page.svelte'
	import Account from '../../src/routes/account/+page.svelte'
	import Login from '../../src/routes/login/+page.svelte'
	import Overview from '../../src/routes/+page.svelte'
	import Workspace from '../../src/routes/settings/workspace/+page.svelte'
	import Categories from '../../src/routes/settings/categories/+page.svelte'
	import Tags from '../../src/routes/settings/tags/+page.svelte'
	import Transactions from '../../src/routes/(transactions)/+layout.svelte'
	import TransactionEntry from '../../src/lib/components/transactions/TransactionEntry.svelte'
	import TransactionEditEntry from '../../src/lib/components/transactions/TransactionEditEntry.svelte'
	import { transactionKindForPath } from '../../src/lib/domain/transaction-kind.js'
	let { client }: { client: FinanceWorkerClient } = $props()
	setFinanceWorker({
		get client() {
			return client
		}
	})
	const route = fromStore(client.location)
	const path = $derived(route.current.pathname)
</script>

<WorkerAccounts
	view={client.view}
	location={client.location}
	onRetryWorkspaceNavigation={client.retryWorkspaceNavigation}
	onSelectWorkspace={client.navigateWorkspace}
	onAccountCreation={client.accountCreationCommand}
	onAccountOrder={client.accountOrderCommand}
	onSelectAccount={client.selectAccount}
	onSelectAllAccounts={client.selectAllAccounts}
>
	{#if path === '/accounts'}
		<Accounts />
	{:else if path === '/account'}
		<Account />
	{:else if path === '/login'}
		<Login />
	{:else if path === '/settings/workspace'}
		<Workspace />
	{:else if path === '/settings/categories'}
		<Categories />
	{:else if path === '/settings/tags'}
		<Tags />
	{:else if path.startsWith('/expenses') || path.startsWith('/income')}
		<Transactions>
			{#if path.endsWith('/new')}
				<TransactionEntry kind={transactionKindForPath(path)} />
			{:else if /^\/(income|expenses)\/[^/]+$/.test(path)}
				<TransactionEditEntry />
			{/if}
		</Transactions>
	{:else}
		<Overview />
	{/if}
</WorkerAccounts>
