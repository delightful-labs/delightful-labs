<script lang="ts">
	import { fromStore, type Readable } from 'svelte/store'
	import { Table, StatusMessage } from 'delightful-ui'
	import WorkspaceSelector from '../workspaces/WorkspaceSelector.svelte'
	import AccountArchiveButton from '../accounts/AccountArchiveButton.svelte'
	import AccountArchiveFeedback from '../accounts/AccountArchiveFeedback.svelte'
	import type { FinanceWorkerView } from '../../contracts/worker-application.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		view,
		onSelectWorkspace,
		onArchive
	}: {
		view: Readable<FinanceWorkerView>
		onSelectWorkspace: (id: string) => void
		onArchive: (id: string) => void
	} = $props()
	const live = $derived(fromStore(view))
</script>

<WorkspaceSelector
	organizations={live.current.workspaces ?? undefined}
	organizationId={live.current.selection.workspaceId}
	onchange={onSelectWorkspace}
/>
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
						><AccountArchiveButton
							action={account.archiveAction}
							onarchive={() => onArchive(account.id)}
						/></td
					>
				</tr>{/each}</tbody
		>
	</Table>
{/if}
