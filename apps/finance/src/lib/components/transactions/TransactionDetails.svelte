<script lang="ts">
	import type { Snippet } from 'svelte'
	import { SYSTEM_ACCOUNT_ID } from 'jazz-tools'
	import { Details } from 'delightful-ui'
	import type { TransactionDetail } from '#lib/schema.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'
	import Avatar, { type AvatarImage } from '../identity/Avatar.svelte'

	type AttributionProfile = AvatarImage & { displayName?: string | null | undefined }

	let {
		transaction,
		form,
		actions,
		attachments,
		creatorProfile,
		editorProfile
	}: {
		transaction: TransactionDetail | undefined | null
		form: Snippet
		actions?: Snippet
		attachments?: Snippet
		creatorProfile: AttributionProfile | null | undefined
		editorProfile: AttributionProfile | null | undefined
	} = $props()
	function authorName(accountId: string, profile: AttributionProfile | null | undefined) {
		return accountId === SYSTEM_ACCOUNT_ID
			? m['bank.system_account_name']()
			: profile?.displayName || accountId
	}
	const timestamps = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' })
	)
</script>

{#if transaction}
	{@render form()}
	{#if attachments}{@render attachments()}{/if}
	{#if actions}{@render actions()}{/if}
	<Details summary={m['transactions.metadata']()}>
		<dl>
			<dt>{m['transactions.created_by']()}</dt>
			<dd class="attribution">
				<Avatar
					avatarData={creatorProfile?.avatarData}
					avatarMimeType={creatorProfile?.avatarMimeType}
					alt=""
				/>
				<span>{authorName(transaction.$createdBy.account, creatorProfile)}</span>
			</dd>
			<dt>{m['transactions.created_at']()}</dt>
			<dd>
				<time datetime={transaction.$createdAt.toISOString()}
					>{timestamps.format(transaction.$createdAt)}</time
				>
			</dd>
			<dt>{m['transactions.updated_by']()}</dt>
			<dd class="attribution">
				<Avatar
					avatarData={editorProfile?.avatarData}
					avatarMimeType={editorProfile?.avatarMimeType}
					alt=""
				/>
				<span>{authorName(transaction.$updatedBy.account, editorProfile)}</span>
			</dd>
			<dt>{m['transactions.updated_at']()}</dt>
			<dd>
				<time datetime={transaction.$updatedAt.toISOString()}
					>{timestamps.format(transaction.$updatedAt)}</time
				>
			</dd>
		</dl>
	</Details>
{:else}
	<p>{m['transactions.unavailable']()}</p>
	{#if actions}{@render actions()}{/if}
{/if}

<style>
	.attribution {
		display: flex;
		align-items: center;
		gap: var(--dui-space-xs, 0.5rem);
	}
</style>
