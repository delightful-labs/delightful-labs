<script lang="ts">
	import type {
		RecoveryScopeSource,
		RecoveryPhraseCapability
	} from 'delightful-local-first/recovery/contracts'

	import { fromStore, type Readable } from 'svelte/store'
	import { Table, StatusMessage, Button } from 'delightful-ui'
	import WorkspaceScopeNotice from '../workspaces/WorkspaceScopeNotice.svelte'
	import AppShell from '../navigation/AppShell.svelte'
	import PageLayout from '../navigation/PageLayout.svelte'
	import { setContext, type Snippet } from 'svelte'
	import { queryLinksKey, type QueryLinkContext } from '../../filters/query-links.js'
	import AccountArchiveButton from '../accounts/AccountArchiveButton.svelte'
	import AccountArchiveFeedback from '../accounts/AccountArchiveFeedback.svelte'
	import type { FinanceWorkerView, WorkerCommandScope } from '../../contracts/worker-application.js'
	import type {
		WorkerAccountOrderCommand,
		WorkerAccountCreationCommand
	} from '../../contracts/worker-forms.js'
	import WorkerLogin from './WorkerLogin.svelte'
	import WorkerRecovery from './WorkerRecovery.svelte'
	import WorkerLedger from './WorkerLedger.svelte'
	import type { TransactionListFilters } from '../../filters/transaction-list-filters.js'
	import { formatSignedMoney } from '../../domain/money.js'
	import { getLocale } from '../../paraglide/runtime.js'
	import WorkerTransactionEntry from './WorkerTransactionEntry.svelte'
	import type { WorkerTransactionEntryCommand } from '../../contracts/worker-forms.js'
	import WorkerAccountCreation from './WorkerAccountCreation.svelte'
	import { m } from '#lib/paraglide/messages.js'
	let {
		view,
		location: observedLocation,
		footer: hostFooter,
		recovery,
		onRestore,
		onRetryRecoveryNavigation,
		onRetryWorkspaceNavigation,
		onSelectWorkspace,
		onArchive,
		onAccountCreation,
		onAccountOrder,
		onTransactionEdit,
		onSelectTransaction,
		onTransactionEntry,
		onLedgerPage,
		onLedgerFilters,
		onSelectAccount,
		onSelectAllAccounts
	}: {
		recovery: { source: RecoveryScopeSource; capability: RecoveryPhraseCapability }
		onRestore: (phrase: string) => void
		onRetryRecoveryNavigation: () => void
		onRetryWorkspaceNavigation: () => void
		onSelectAccount: (id: string, checked: boolean, scope: WorkerCommandScope) => void
		onSelectAllAccounts: (checked: boolean, scope: WorkerCommandScope) => void
		view: Readable<FinanceWorkerView>
		location: Readable<URL>
		footer?: Snippet | undefined
		onSelectWorkspace: (id: string) => void
		onArchive: (id: string, scope: WorkerCommandScope) => void
		onLedgerPage: (page: number, scope: WorkerCommandScope) => void
		onLedgerFilters: (filters: TransactionListFilters, scope: WorkerCommandScope) => void
		onSelectTransaction: (id: string | null, scope: WorkerCommandScope) => void
		onTransactionEdit: (command: WorkerTransactionEntryCommand, scope: WorkerCommandScope) => void
		onTransactionEntry: (command: WorkerTransactionEntryCommand, scope: WorkerCommandScope) => void
		onAccountOrder: (command: WorkerAccountOrderCommand, scope: WorkerCommandScope) => void
		onAccountCreation: (command: WorkerAccountCreationCommand, scope: WorkerCommandScope) => void
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
	{#snippet children(navigation)}
		<PageLayout {navigation}>
			{#snippet pageHeading()}<h1>{m['nouns.account']({ count: 2 })}</h1>{/snippet}
			<WorkerRecovery binding={recovery} />
			<WorkerLogin view={live.current} {onRestore} onRetryNavigation={onRetryRecoveryNavigation} />
			<WorkspaceScopeNotice
				active={live.current.workspaceNavigation?.notice.active ?? false}
				failed={live.current.workspaceNavigation?.notice.failed ?? false}
				loading={live.current.workspaceNavigation?.notice.loading ?? false}
				onRetry={onRetryWorkspaceNavigation}
			/>
			{#if live.current.workspaceNavigation?.showContent ?? true}
				<AccountArchiveFeedback feedback={live.current.archiveFeedback} />
				{#if live.current.status === 'failed'}
					<StatusMessage
						variant="error"
						text={m['errors.load_subject']({ subject: m['nouns.account']({ count: 2 }) })}
					/>
				{:else if live.current.status === 'starting' || live.current.status === 'loading'}
					<StatusMessage
						variant="loading"
						text={m['status.loading_subject']({ subject: m['nouns.account']({ count: 2 }) })}
					/>
				{:else if live.current.status !== 'ready'}
					<p role="status">{m['accounts.archive_session_unavailable']()}</p>
				{:else if !live.current.selection.workspaceId}
					<p>{m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}</p>
				{:else if !live.current.accounts.length}
					<p>{m['accounts.empty.title']()}</p>
				{:else}
					<Table caption={m['nouns.account']({ count: 2 })}>
						<thead
							><tr>
								<th scope="col"
									>{m['labels.subject_name']({ subject: m['nouns.account']({ count: 1 }) })}</th
								>
								<th scope="col"
									>{m['labels.subject_type']({ subject: m['nouns.account']({ count: 1 }) })}</th
								>
								<th scope="col">{m['labels.currency']()}</th>
								<th scope="col">{m['labels.calculated_balance']()}</th>
								<th scope="col">{m['labels.actions']()}</th>
							</tr></thead
						>
						<tbody
							>{#each live.current.accounts as account (account.id)}<tr>
									<td>{account.name}</td>
									<td
										>{account.kind === 'cash'
											? m['labels.cash']()
											: account.kind === 'bank'
												? m['accounts.type.bank']()
												: m['accounts.type.card']()}</td
									>
									<td>{account.currency}</td>
									<td
										>{account.balanceMinor === null
											? '—'
											: formatSignedMoney(account.balanceMinor, account.currency, getLocale())}</td
									>
									<td
										><AccountArchiveButton
											action={account.archiveAction}
											onarchive={() =>
												onArchive(account.id, {
													sessionRevision: live.current.sessionRevision,
													selection: live.current.selection
												})}
										/></td
									>
								</tr>{/each}</tbody
						>
					</Table>
				{/if}

				{#if live.current.transactionId}
					<Button type="button" onclick={() => onSelectTransaction(null, live.current)}
						>{m['actions.back_to_subject']({ subject: m['nouns.list']({ count: 1 }) })}</Button
					>
					<WorkerTransactionEntry
						view={live.current}
						entry={live.current.transactionEdit}
						onsend={onTransactionEdit}
					/>
				{:else}
					<WorkerTransactionEntry view={live.current} onsend={onTransactionEntry} />
				{/if}

				<WorkerLedger
					view={live.current}
					onPage={onLedgerPage}
					onFilters={onLedgerFilters}
					onOpen={onSelectTransaction}
				/>
			{/if}
		</PageLayout>
	{/snippet}
</AppShell>
