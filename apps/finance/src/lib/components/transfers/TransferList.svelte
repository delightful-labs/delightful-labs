<script lang="ts">
	import type {
		WorkerTransferListView,
		WorkerLedgerRecord
	} from '#lib/contracts/worker-application.js'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'
	import { Text } from 'delightful-ui'
	import TransactionListView from '../transactions/TransactionListView.svelte'
	import AppLink from '../navigation/AppLink.svelte'
	let {
		view,
		pageHref,
		transferHref,
		onPage
	}: {
		view: WorkerTransferListView
		pageHref: (page: number) => string
		transferHref: (id: string) => string
		onPage: (page: number) => void
	} = $props()
	const groups = $derived(view.groups.map((group) => ({ ...group, totals: new Map(group.totals) })))
	const accountNames = $derived(new Map(view.accounts.map((account) => [account.id, account.name])))
	const incomeByExpense = $derived(
		new Map(view.pairs.map((pair) => [pair.expense.id, pair.income]))
	)
	const dateFormatter = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeZone: 'UTC' })
	)
	function transactionHref(id: string) {
		return transferHref(view.pairs.find((pair) => pair.expense.id === id)?.id ?? id)
	}
	function money(row: WorkerLedgerRecord) {
		return formatMoney(row.amountMinor, row.currency, getLocale())
	}
</script>

<TransactionListView
	{groups}
	noAccountsSelected={view.noAccountsSelected}
	page={view.page}
	pageCount={view.pageCount}
	{onPage}
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
</TransactionListView>

<style>
	li :global(.transfer-link) {
		display: grid;
		gap: var(--dui-spacing-xs);
		padding: var(--dui-spacing-xs);
	}
</style>
