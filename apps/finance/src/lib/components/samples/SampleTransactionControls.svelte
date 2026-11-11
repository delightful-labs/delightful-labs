<script lang="ts">
	import { INCOME, type TransactionKind } from '#lib/domain/transaction-kind.js'
	import { Button, Text } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		kind,
		busy,
		saved,
		failed,
		onadd
	}: {
		kind: TransactionKind
		busy: boolean
		saved: number
		failed: boolean
		onadd: () => void
	} = $props()
</script>

<div>
	<Button type="button" disabled={busy} onclick={onadd}
		>{m['actions.add_sample_count_kind_subjects']({
			count: 25,
			kind: kind === INCOME ? m['nouns.income']({ count: 1 }) : m['nouns.expense']({ count: 1 }),
			subjects: m['nouns.transaction']({ count: 25 })
		})}</Button
	>
	<Text>{m['transactions.samples.description']()}</Text>
	{#if busy || saved > 0 || failed}
		<Text role="status"
			>{failed
				? m['transactions.samples.failed_count']({ count: saved })
				: m['transactions.samples.saved_count']({ count: saved })}</Text
		>
	{/if}
</div>
