<script lang="ts">
	import { Button } from 'delightful-ui'
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import { formatMoney } from '#lib/domain/money.js'
	import type { InternalTransferCandidate } from '#lib/domain/internal-transfer.js'
	import type { TransactionRow } from '#lib/schema.js'
	import type {
		TransactionEditTransferState,
		TransferStatusLabel
	} from '#lib/machines/transactions/transaction-edit.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'

	type Suggestion = InternalTransferCandidate & {
		accountName: string | undefined
		description: TransactionRow['description'] | undefined
	}
	let {
		suggestions,
		writableSuggestionIds,
		editorState,
		selectedId,
		onSelect,
		pending,
		statusLabel,
		onLink,
		unlinkAvailable,
		unlinkWritable,
		unlinkPending,
		linkedCounterpartHref,
		onUnlink
	}: {
		suggestions: readonly Suggestion[]
		writableSuggestionIds: ReadonlySet<string>
		editorState: Exclude<TransactionEditTransferState, 'unselected'>
		selectedId: string | null
		onSelect: ((transactionId: string) => void) | undefined
		pending: boolean
		statusLabel: TransferStatusLabel | null
		onLink: (transactionId: string) => void
		unlinkAvailable: boolean
		unlinkWritable: boolean
		unlinkPending: boolean
		linkedCounterpartHref: string | null
		onUnlink: (() => void) | undefined
	} = $props()

	const selectedSuggestionIsWritable = $derived(
		selectedId !== null && writableSuggestionIds.has(selectedId)
	)
	const dates = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeZone: 'UTC' })
	)
	function formatDate(value: string) {
		return dates.format(new Date(`${value}T00:00:00.000Z`))
	}
	const statusMessage = $derived(statusLabel?.() ?? '')
</script>

<section aria-labelledby="transfer-suggestions-heading">
	<h2 id="transfer-suggestions-heading">{m['transfers.suggestions_heading']()}</h2>
	{#if editorState === 'linked'}
		<p>{m['labels.linked_name']({ name: m['nouns.transfer']({ count: 1 }) })}</p>
		{#if linkedCounterpartHref}
			<AppLink href={linkedCounterpartHref}
				>{m['actions.open_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}</AppLink
			>
		{/if}
		{#if unlinkAvailable && onUnlink}
			<Button type="button" disabled={!unlinkWritable || unlinkPending} onclick={onUnlink}>
				{m['actions.unlink_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
			</Button>
		{/if}
		{#if unlinkAvailable && !unlinkWritable}<p>
				{m['forms.read_only']()}
			</p>{/if}
		{#if !unlinkAvailable && !unlinkPending}<p>
				{m['errors.save_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
			</p>{/if}
	{/if}
	{#if editorState === 'conflicted'}
		<p>{m['transfers.conflict_notice']()}</p>
	{/if}
	{#if editorState === 'empty'}
		<p>{m['labels.no_subjects_yet']({ subjects: m['nouns.transaction']({ count: 2 }) })}</p>
	{/if}
	{#if editorState === 'matches'}
		<fieldset>
			<legend
				>{m['actions.select_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}</legend
			>
			<ul>
				{#each suggestions as suggestion (suggestion.id)}
					<li>
						<label>
							<input
								type="radio"
								name="transfer-counterpart"
								value={suggestion.id}
								checked={selectedId === suggestion.id}
								onchange={() => onSelect?.(suggestion.id)}
							/>
							<span>
								{formatDate(suggestion.bookedOn)} · {suggestion.accountName ??
									m['status.unavailable_subject']({ subject: m['nouns.account']({ count: 1 }) })}
								{#if suggestion.description}
									· {suggestion.description}{/if}
							</span>
							<span>{formatMoney(suggestion.amountMinor, suggestion.currency, getLocale())}</span>
						</label>
					</li>
				{/each}
			</ul>
		</fieldset>
		<Button
			type="button"
			disabled={!selectedId || !selectedSuggestionIsWritable || pending}
			onclick={() => {
				if (selectedId) onLink(selectedId)
			}}
		>
			{m['actions.link_existing_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
		</Button>
		{#if !selectedSuggestionIsWritable}
			<p>{m['forms.read_only']()}</p>
		{/if}
	{/if}
	<p>{statusMessage}</p>
</section>

<style>
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}

	ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: var(--dui-space-sm);
	}

	label {
		display: flex;
		align-items: start;
		gap: var(--dui-space-xs);
	}
</style>
