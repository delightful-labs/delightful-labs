<script lang="ts">
	import { InputCurrency, InputDate, InputText, Select } from 'delightful-ui'
	import type { Account, TransactionRow } from '#lib/schema.js'
	import { minorUnitsToInput } from '#lib/domain/money.js'
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
		<Select
			label={side.source
				? m['transfers.source_subject']({ subject: m['nouns.account']({ count: 1 }) })
				: m['transfers.destination_subject']({ subject: m['nouns.account']({ count: 1 }) })}
			id={`${id}-${side.row.id}-account`}
			value={side.row.accountId}
			disabled
		>
			{#each accounts as account (account.id)}<option value={account.id}
					>{account.name} · {account.currency}</option
				>{/each}
		</Select>
		<InputCurrency
			label={side.source
				? m['transfers.source_subject']({ subject: m['labels.amount']() })
				: m['transfers.destination_subject']({ subject: m['labels.amount']() })}
			id={`${id}-${side.row.id}-amount`}
			currencyLabel={side.row.currency}
			value={minorUnitsToInput(side.row.amountMinor, side.row.currency)}
			disabled
		/>
		<InputDate
			label={side.source
				? m['transfers.source_subject']({ subject: m['nouns.date']({ count: 1 }) })
				: m['transfers.destination_subject']({ subject: m['nouns.date']({ count: 1 }) })}
			id={`${id}-${side.row.id}-date`}
			value={side.row.bookedOn}
			disabled
		/>
		{#if side.row.description}<InputText
				label={m['labels.description']()}
				id={`${id}-${side.row.id}-description`}
				value={side.row.description}
				disabled
			/>{/if}
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
