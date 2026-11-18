<script lang="ts">
	import type { Account, TransactionRow } from '#lib/schema.js'
	import TransactionFields from '../transactions/TransactionFields.svelte'
	import { m } from '#lib/paraglide/messages.js'
	import AppLink from '../navigation/AppLink.svelte'
	let {
		expense,
		income,
		accounts
	}: { expense: TransactionRow; income: TransactionRow; accounts: readonly Account[] } = $props()
	const id = $props.id()
</script>

<form onsubmit={(event) => event.preventDefault()}>
	{#each [{ row: expense, source: true, path: '/expenses' }, { row: income, source: false, path: '/income' }] as side (side.row.id)}
		<TransactionFields
			{accounts}
			initialTransaction={side.row}
			selectedAccountId={side.row.accountId}
			idPrefix={`${id}-${side.row.id}`}
			disabled
			hideEmptyDescription
			accountLabel={side.source
				? m['transfers.source_subject']({ subject: m['nouns.account']({ count: 1 }) })
				: m['transfers.destination_subject']({ subject: m['nouns.account']({ count: 1 }) })}
			amountLabel={side.source
				? m['transfers.source_subject']({ subject: m['labels.amount']() })
				: m['transfers.destination_subject']({ subject: m['labels.amount']() })}
			dateLabel={side.source
				? m['transfers.source_subject']({ subject: m['nouns.date']({ count: 1 }) })
				: m['transfers.destination_subject']({ subject: m['nouns.date']({ count: 1 }) })}
		/>
		<AppLink href={`${side.path}/${encodeURIComponent(side.row.id)}`}
			>{m['labels.subject_details']({
				subject: side.source ? m['nouns.expense']({ count: 1 }) : m['nouns.income']({ count: 1 })
			})}</AppLink
		>
	{/each}
</form>

<style>
	form {
		display: grid;
		gap: var(--dui-spacing-md);
	}
</style>
