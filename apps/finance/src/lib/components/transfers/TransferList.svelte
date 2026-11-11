<script lang="ts">
	import type { TransactionRow } from '#lib/schema.js'
	import { groupTransactionsByDate } from '#lib/domain/transaction-groups.js'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'
	import { Text } from 'delightful-ui'
	import TransactionList from '../transactions/TransactionList.svelte'
	import AppLink from '../navigation/AppLink.svelte'
	let {
		pairs,
		accountNames,
		noAccountsSelected,
		requestedPage,
		pageHref,
		transferHref
	}: {
		pairs: readonly { id: string; expense: TransactionRow; income: TransactionRow }[]
		accountNames: ReadonlyMap<string, string>
		noAccountsSelected: boolean
		requestedPage: number
		pageHref: (page: number) => string
		transferHref: (id: string) => string
	} = $props()
	const groups = $derived(groupTransactionsByDate(pairs.map((pair) => pair.expense)))
	const incomeByExpense = $derived(new Map(pairs.map((pair) => [pair.expense.id, pair.income])))
	const dateFormatter = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeZone: 'UTC' })
	)
	function transactionHref(id: string) {
		const pair = pairs.find((pair) => pair.expense.id === id)
		return transferHref(pair?.id ?? id)
	}
	function money(row: TransactionRow) {
		return formatMoney(row.amountMinor, row.currency, getLocale())
	}
</script>

<TransactionList
	{groups}
	{noAccountsSelected}
	{requestedPage}
	{pageHref}
	{transactionHref}
	categoryNames={new Map()}
	tagNamesByTransaction={new Map()}
	showTotals={false}
>
	{#snippet item(expense)}
		{@const income = incomeByExpense.get(expense.id)}
		{#if income}
			{@const source =
				accountNames.get(expense.accountId) ??
				m['status.unavailable_subject']({ subject: m['nouns.account']({ count: 1 }) })}
			{@const destination =
				accountNames.get(income.accountId) ??
				m['status.unavailable_subject']({ subject: m['nouns.account']({ count: 1 }) })}
			<li>
				<AppLink
					href={transactionHref(expense.id)}
					class="transfer-link"
					aria-label={`${m['labels.subject_details']({ subject: m['nouns.transfer']({ count: 1 }) })}: ${source} → ${destination}, ${money(expense)} → ${money(income)}`}
				>
					<Text size="sm"><strong>{source} → {destination}</strong></Text>
					<Text size="sm"
						><time datetime={expense.bookedOn}
							>{dateFormatter.format(new Date(`${expense.bookedOn}T00:00:00Z`))}</time
						>
						→
						<time datetime={income.bookedOn}
							>{dateFormatter.format(new Date(`${income.bookedOn}T00:00:00Z`))}</time
						></Text
					>
					{#if expense.description}<Text size="sm"><em>{expense.description}</em></Text>{/if}
					{#if income.description && income.description !== expense.description}<Text size="sm"
							><em>{income.description}</em></Text
						>{/if}
					<Text size="sm" as="span"
						>{money(
							expense
						)}{#if expense.currency !== income.currency || expense.amountMinor !== income.amountMinor}
							→ {money(income)}{/if}</Text
					>
				</AppLink>
			</li>
		{/if}
	{/snippet}
</TransactionList>

<style>
	li :global(.transfer-link) {
		display: grid;
		gap: var(--dui-spacing-xs);
		padding: var(--dui-spacing-xs);
	}
</style>
