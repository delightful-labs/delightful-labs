<script lang="ts">
	import { Text, ScreenReaderText } from 'delightful-ui'
	import type { TransactionListRow } from '../../domain/transaction-groups.js'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionListItemButton from './TransactionListItemButton.svelte'
	import AppLink from '../navigation/AppLink.svelte'

	let {
		transaction,
		href,
		onclick,
		categoryName,
		tagNames = []
	}: {
		href: string
		onclick?: ((event: MouseEvent) => void) | undefined
		transaction: TransactionListRow
		categoryName: string | undefined
		tagNames?: readonly string[]
	} = $props()
	const tags = $derived(new Intl.ListFormat(getLocale(), { style: 'short', type: 'unit' }))
</script>

<li class="list-item">
	<div class="header">
		<Text size="sm" as="span">
			{categoryName ??
				m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) })}</Text
		>
		{#if tagNames.length}<Text size="sm" as="span">{tags.format(tagNames)}</Text>{/if}
		<Text size="sm" as="span" style={'margin-inline-start: auto'}
			>{formatMoney(transaction.amountMinor, transaction.currency, getLocale())}</Text
		>
		<AppLink
			{href}
			{onclick}
			component={TransactionListItemButton}
			aria-label={`${m['labels.subject_details']({ subject: m['nouns.transaction']({ count: 1 }) })}: ${categoryName ?? m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) })}, ${transaction.description ? `${transaction.description}, ` : ''}${formatMoney(transaction.amountMinor, transaction.currency, getLocale())}`}
			><ScreenReaderText
				>${m['labels.subject_details']({
					subject: m['nouns.transaction']({ count: 1 })
				})}</ScreenReaderText
			></AppLink
		>
	</div>
	{#if transaction.description}<Text size="sm"><em>{transaction.description}</em></Text>{/if}
</li>

<style>
	.list-item {
		position: relative;
		display: grid;
		gap: var(--dui-spacing-xs);
		padding: var(--dui-spacing-xs);
	}
	.header {
		display: flex;
		gap: var(--dui-spacing-xs);
		align-items: center;
	}
</style>
