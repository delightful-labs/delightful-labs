<script lang="ts">
	import { fromStore, type Readable } from 'svelte/store'
	import { Table, StatusMessage, Button } from 'delightful-ui'
	import WorkspaceSelector from '../workspaces/WorkspaceSelector.svelte'
	import AccountArchiveButton from '../accounts/AccountArchiveButton.svelte'
	import AccountArchiveFeedback from '../accounts/AccountArchiveFeedback.svelte'
	import type { FinanceWorkerView, WorkerCommandScope } from '../../contracts/worker-application.js'
	import type { WorkerAccountCreationCommand } from '../../contracts/worker-forms.js'
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
		onSelectWorkspace,
		onArchive,
		onAccountCreation,
		onTransactionEdit,
		onSelectTransaction,
		onTransactionEntry,
		onLedgerPage,
		onLedgerFilters
	}: {
		view: Readable<FinanceWorkerView>
		onSelectWorkspace: (id: string) => void
		onArchive: (id: string, scope: WorkerCommandScope) => void
		onLedgerPage: (page: number, scope: WorkerCommandScope) => void
		onLedgerFilters: (filters: TransactionListFilters, scope: WorkerCommandScope) => void
		onSelectTransaction: (id: string | null) => void
		onTransactionEdit: (command: WorkerTransactionEntryCommand, scope: WorkerCommandScope) => void
		onTransactionEntry: (command: WorkerTransactionEntryCommand, scope: WorkerCommandScope) => void
		onAccountCreation: (command: WorkerAccountCreationCommand, scope: WorkerCommandScope) => void
	} = $props()
	const live = $derived(fromStore(view))
</script>

<WorkspaceSelector
	organizations={live.current.workspaces ?? undefined}
	organizationId={live.current.selection.workspaceId}
	onchange={onSelectWorkspace}
/>
<WorkerAccountCreation view={live.current} onsend={onAccountCreation} />
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
	<Button type="button" onclick={() => onSelectTransaction(null)}
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
