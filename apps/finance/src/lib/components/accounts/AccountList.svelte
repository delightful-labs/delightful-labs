<script lang="ts">
	import { ACCOUNT_KIND } from '#lib/domain/account-kind.js'
	import { Button, Table, StatusMessage } from 'delightful-ui'
	import type { WorkerAccountArchiveView } from '#lib/contracts/worker-accounts.js'
	import type { AccountMembership, OrganizationMember } from '#lib/queries.js'
	import AccountArchiveFeedback from './AccountArchiveFeedback.svelte'
	import AccountActionsDialog from './AccountActionsDialog.svelte'
	import { m } from '#lib/paraglide/messages.js'
	import { formatSignedMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import type { ComponentProps } from 'svelte'

	let {
		view,
		onArchive,
		deleteGrantView,
		onDeleteGrant,
		balances,
		grantQueries
	}: {
		view: WorkerAccountArchiveView
		onArchive: (accountId: string) => void
		deleteGrantView: ComponentProps<typeof AccountActionsDialog>['deleteGrantView']
		onDeleteGrant: (accountId: string, userId: string, canDelete: boolean) => void
		balances: ReadonlyMap<string, bigint> | null
		grantQueries: ComponentProps<typeof AccountActionsDialog>['grantQueries']
	} = $props()

	let selectedAccountId = $state<string | null>(null)
	let dialogOpen = $state(false)
	const selectedAccount = $derived(
		view.kind === 'ready'
			? view.rows.find((row) => row.account.id === selectedAccountId)?.account
			: undefined
	)
	$effect(() => {
		if (selectedAccountId && !selectedAccount) {
			selectedAccountId = null
			dialogOpen = false
		}
	})
</script>

{#if view.kind === 'sessionUnavailable'}
	<p role="status">{m['accounts.archive_session_unavailable']()}</p>
{:else if view.kind === 'loading'}
	<StatusMessage
		variant="loading"
		text={m['status.loading_subject']({ subject: m['nouns.account']({ count: 2 }) })}
	/>
{:else if view.kind === 'selectWorkspace'}
	<p>{m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}</p>
{:else if view.kind === 'loadFailed'}
	<StatusMessage
		variant="error"
		text={m['errors.load_subject']({ subject: m['nouns.account']({ count: 2 }) })}
	/>
{:else if view.kind === 'ready'}
	<AccountArchiveFeedback feedback={view.feedback} />
	{#if view.rows.length === 0}
		<p>{m['accounts.empty.title']()}</p>
	{:else}
		<Table caption={m['nouns.account']({ count: 2 })}>
			<thead>
				<tr>
					<th scope="col"
						>{m['labels.subject_name']({ subject: m['nouns.account']({ count: 1 }) })}</th
					>
					<th scope="col"
						>{m['labels.subject_type']({ subject: m['nouns.account']({ count: 1 }) })}</th
					>
					<th scope="col">{m['labels.currency']()}</th>
					<th scope="col">{m['labels.calculated_balance']()}</th>
					<th scope="col">{m['labels.actions']()}</th>
				</tr>
			</thead>
			<tbody>
				{#each view.rows as row (row.account.id)}
					{@const account = row.account}
					<tr>
						<td>{account.name}</td>
						<td>
							{account.kind === ACCOUNT_KIND.CASH
								? m['labels.cash']()
								: account.kind === ACCOUNT_KIND.BANK
									? m['accounts.type.bank']()
									: m['accounts.type.card']()}
						</td>
						<td>{account.currency}</td>
						<td>
							{balances === null
								? '—'
								: formatSignedMoney(balances.get(account.id) ?? 0n, account.currency, getLocale())}
						</td>
						<td>
							<Button
								type="button"
								aria-label={m['actions.manage_subject']({ subject: account.name })}
								onclick={() => {
									selectedAccountId = account.id
									dialogOpen = true
								}}
							>
								{m['actions.manage_subject']({ subject: account.name })}
							</Button>
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
		<AccountActionsDialog
			account={selectedAccount}
			archiveAction={selectedAccount
				? view.rows.find((row) => row.account.id === selectedAccount.id)?.action
				: undefined}
			{deleteGrantView}
			{grantQueries}
			bind:open={dialogOpen}
			onArchive={() => selectedAccount && onArchive(selectedAccount.id)}
			{onDeleteGrant}
		/>
	{/if}
{/if}
