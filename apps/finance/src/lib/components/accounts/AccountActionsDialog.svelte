<script lang="ts">
	import { Button, ButtonContent, Dialog, StatusMessage } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
	import type { AccountArchiveView } from '#lib/machines/accounts/account-archive.js'
	import type { AccountDeleteGrantView } from '#lib/machines/accounts/account-delete-grants.js'
	import type { Account, AccountMembership, OrganizationMember } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'
	import type { ComponentProps } from 'svelte'
	import QueryContent from '../shared/QueryContent.svelte'

	let {
		account,
		archiveAction,
		deleteGrantView,
		grantQueries,
		open = $bindable(false),
		onArchive,
		onDeleteGrant
	}: {
		account: Account | undefined
		archiveAction: 'available' | 'archiving' | 'disabled' | 'unavailable' | undefined
		deleteGrantView: AccountDeleteGrantView & {
			canManage: boolean
			members: readonly OrganizationMember[]
			grants: readonly AccountMembership[]
		}
		grantQueries: ComponentProps<typeof QueryContent>['queries']
		open?: boolean
		onArchive: () => void
		onDeleteGrant: (accountId: string, userId: string, canDelete: boolean) => void
	} = $props()
	const grantFeedback = $derived(
		deleteGrantView.result?.outcome === 'succeeded'
			? m['permissions.updated']()
			: deleteGrantView.result?.outcome === 'failed'
				? m['permissions.update_failed']()
				: deleteGrantView.result?.outcome === 'denied'
					? m['permissions.manage_restricted']()
					: undefined
	)
	const accountGrantFeedback = $derived(
		deleteGrantView.result?.request?.accountId === account?.id ? grantFeedback : undefined
	)
</script>

<Dialog heading={account?.name ?? m['nouns.account']({ count: 1 })} bind:open closedby="any">
	{#if account}
		<section>
			<h3>{m['labels.actions']()}</h3>
			{#if archiveAction && archiveAction !== 'unavailable'}
				<Button
					type="button"
					disabled={archiveAction !== 'available'}
					aria-busy={archiveAction === 'archiving'}
					onclick={onArchive}
				>
					<ButtonContent
						icon={ArchiveIcon}
						loading={archiveAction === 'archiving'}
						text={archiveAction === 'archiving'
							? m['status.archiving_subject']({ subject: m['nouns.account']({ count: 1 }) })
							: m['actions.archive_button']()}
					/>
				</Button>
			{:else}
				<p>{m['accounts.archive_restricted']()}</p>
			{/if}
			{#if deleteGrantView.canManage}
				<QueryContent
					queries={grantQueries}
					loadingMessage={m['status.loading_subject']({
						subject: m['nouns.permission']({ count: 2 })
					})}
					errorMessage={m['errors.load_subject']({
						subject: m['nouns.permission']({ count: 2 })
					})}
				>
					<fieldset>
						<legend
							>{m['actions.delete_subject']({
								subject: m['nouns.transaction']({ count: 2 })
							})}</legend
						>
						<p>{m['accounts.delete_access_description']()}</p>
						{#each deleteGrantView.members as member (member.id)}
							{@const granted = deleteGrantView.grants.some(
								(grant) =>
									grant.accountId === account.id &&
									grant.userId === member.userId &&
									grant.canDelete
							)}
							<label>
								<input
									type="checkbox"
									checked={granted}
									disabled={deleteGrantView.busy}
									onchange={(event) =>
										onDeleteGrant(account.id, member.userId, event.currentTarget.checked)}
								/>
								{m['accounts.delete_access_for_name']({ name: member.userId })}
							</label>
						{/each}
					</fieldset>
				</QueryContent>
			{:else}
				<p>{m['permissions.manage_restricted']()}</p>
			{/if}
			{#if accountGrantFeedback}
				<StatusMessage
					variant={deleteGrantView.result?.outcome === 'succeeded' ? 'success' : 'error'}
					text={accountGrantFeedback}
				/>
			{/if}
		</section>
	{/if}
</Dialog>
