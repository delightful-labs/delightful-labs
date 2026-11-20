<script lang="ts">
	import { fromStore, type Readable } from 'svelte/store'
	import WorkspaceScopeNotice from '../workspaces/WorkspaceScopeNotice.svelte'
	import AppShell from '../navigation/AppShell.svelte'
	import { setContext, type Snippet } from 'svelte'
	import { queryLinksKey, type QueryLinkContext } from '../../filters/query-links.js'
	import type { FinanceWorkerView, WorkerCommandScope } from '../../contracts/worker-application.js'
	import type {
		WorkerAccountOrderCommand,
		WorkerFormCommand
	} from '../../contracts/worker-forms.js'
	import WorkerAccountCreation from './WorkerAccountCreation.svelte'
	let {
		view,
		children: pageContent,
		notices,
		location: observedLocation,
		footer: hostFooter,
		onRetryWorkspaceNavigation,
		onSelectWorkspace,
		onAccountCreation,
		onAccountOrder,
		onSelectAccount,
		onSelectAllAccounts
	}: {
		onRetryWorkspaceNavigation: () => void
		onSelectAccount: (id: string, checked: boolean, scope: WorkerCommandScope) => void
		onSelectAllAccounts: (checked: boolean, scope: WorkerCommandScope) => void
		children: Snippet<[FinanceWorkerView]>
		notices?: Snippet<[FinanceWorkerView]>
		view: Readable<FinanceWorkerView>
		location: Readable<URL>
		footer?: Snippet | undefined
		onSelectWorkspace: (id: string) => void
		onAccountOrder: (command: WorkerAccountOrderCommand, scope: WorkerCommandScope) => void
		onAccountCreation: (command: WorkerFormCommand, scope: WorkerCommandScope) => void
	} = $props()
	const live = $derived(fromStore(view))
	const route = $derived(fromStore(observedLocation))
	setContext<QueryLinkContext>(queryLinksKey, {
		get href() {
			return route.current.href
		},
		keys: ['workspace']
	})
	const balances = $derived(
		live.current.accounts.some((account) => account.balanceMinor === null)
			? null
			: new Map(live.current.accounts.map((account) => [account.id, account.balanceMinor ?? 0n]))
	)
</script>

<AppShell
	pathname={route.current.pathname}
	organizations={live.current.workspaces ?? undefined}
	accounts={live.current.accounts}
	accountBalances={balances}
	organizationId={live.current.selection.workspaceId}
	selectedAccountIds={live.current.selectedAccountIds}
	organizationQueries={[
		{
			isLoading: live.current.workspaces === null,
			error: live.current.status === 'failed' ? true : null
		}
	]}
	accountQueries={[
		{
			isLoading: live.current.status === 'starting' || live.current.status === 'loading',
			error: live.current.status === 'failed' ? true : null
		}
	]}
	onOrganizationChange={onSelectWorkspace}
	onAccountChange={(id, checked) =>
		onSelectAccount(id, checked, {
			sessionRevision: live.current.sessionRevision,
			selection: live.current.selection
		})}
	onAllAccountsChange={(checked) =>
		onSelectAllAccounts(checked, {
			sessionRevision: live.current.sessionRevision,
			selection: live.current.selection
		})}
	editingAccountOrder={live.current.accountOrder?.editing ?? false}
	canToggleAccountOrder={live.current.accountOrder?.canToggle ?? false}
	canMoveAccount={(id, direction) =>
		live.current.accountOrder?.moves.find((move) => move.id === id)?.[direction] ?? false}
	onEditAccountOrder={() => onAccountOrder({ type: 'EDIT' }, live.current)}
	onDoneAccountOrder={() => onAccountOrder({ type: 'DONE' }, live.current)}
	onMoveAccount={(id, direction) => onAccountOrder({ type: 'MOVE', id, direction }, live.current)}
>
	{#snippet accountCreation(trigger)}
		<WorkerAccountCreation view={live.current} onsend={onAccountCreation} {trigger} />
	{/snippet}
	{#snippet footer()}{@render hostFooter?.()}{/snippet}
	{#snippet children()}
		<div class="application-page">
			<div class="application-notices">
				{@render notices?.(live.current)}
				<WorkspaceScopeNotice
					active={live.current.status !== 'failed' &&
						(live.current.workspaceNavigation?.notice.active ?? false)}
					failed={live.current.workspaceNavigation?.notice.failed ?? false}
					loading={live.current.workspaceNavigation?.notice.loading ?? false}
					onRetry={onRetryWorkspaceNavigation}
				/>
			</div>
			<div class="application-content">
				{#if live.current.workspaceNavigation?.showContent || (live.current.status !== 'ready' && (route.current.pathname === '/login' || route.current.pathname === '/account'))}
					{@render pageContent(live.current)}
				{/if}
			</div>
		</div>
	{/snippet}
</AppShell>

<style>
	.application-page {
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-block-size: 0;
	}
	.application-notices {
		flex: 0 0 auto;
	}
	.application-content {
		flex: 1 1 0%;
		min-block-size: 0;
	}
</style>
