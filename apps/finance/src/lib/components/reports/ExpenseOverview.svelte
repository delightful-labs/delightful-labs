<script lang="ts">
	import type { Snippet } from 'svelte'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { EXPENSES_PATH } from '#lib/domain/transaction-kind.js'
	import ExpensePieChart from './ExpensePieChart.svelte'
	import { Heading, Text, InputText, Select } from 'delightful-ui'
	import FilterPopovers from '../filters/FilterPopovers.svelte'
	import { filterTransactions } from '#lib/filters/transaction-list-filters.js'
	import DateRangeFilter from '../filters/DateRangeFilter.svelte'
	import CategoryLegend from './CategoryLegend.svelte'
	import TransactionItems from '../transactions/TransactionItems.svelte'
	import type { TransactionRow } from '#lib/schema.js'
	import type { InternalTransferResolution } from '#lib/domain/internal-transfer.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		navigation = emptyNavigation,
		transactions,
		categoryNames,
		tagNamesByTransaction,
		internalTransferResolution,
		filters = null,
		onfilterschange = () => {}
	}: {
		navigation?: Snippet
		transactions: readonly TransactionRow[]
		categoryNames: ReadonlyMap<string, string>
		tagNamesByTransaction: ReadonlyMap<string, readonly string[]>
		internalTransferResolution: InternalTransferResolution
		filters?: { start: string; end: string; categoryId: string | null; currency: string } | null
		onfilterschange?: (filters: {
			start: string
			end: string
			categoryId: string | null
			currency: string
		}) => void
	} = $props()
	function daysAgo(days: number) {
		const date = new Date()
		date.setDate(date.getDate() - (days - 1))
		return todayDateOnly(date)
	}
	let query = $state('')
	let start = $state(daysAgo(30))
	let end = $state(todayDateOnly())
	let selectedCategory = $state<string | null>(null)
	let selectedCurrency = $state('USD')
	$effect(() => {
		if (!filters) return
		start = filters.start
		end = filters.end
		selectedCategory = filters.categoryId
		selectedCurrency = filters.currency
	})
	$effect(() =>
		onfilterschange({ start, end, categoryId: selectedCategory, currency: selectedCurrency })
	)
	const validRange = $derived(Boolean(start && end && start <= end))
	const unlinkedTransactions = $derived(
		filterTransactions(
			transactions.filter(
				(row) => !internalTransferResolution.suppressedTransactionIds.has(row.id)
			),
			{ query, start: '', end: '', categoryId: '', currency: '' },
			categoryNames,
			tagNamesByTransaction
		)
	)
	const period = $derived(
		validRange
			? unlinkedTransactions.filter((row) => row.bookedOn >= start && row.bookedOn <= end)
			: []
	)
	const currencies = $derived([...new Set(period.map((row) => row.currency))].sort())
	const currency = $derived(
		currencies.includes(selectedCurrency) ? selectedCurrency : (currencies[0] ?? 'USD')
	)
	const expenses = $derived(period.filter((row) => row.currency === currency))
	const categoryIds = $derived(
		[...new Set(unlinkedTransactions.map((row) => row.categoryId))].sort()
	)
	// A shared perceptual lightness/chroma keeps the categorical palette cohesive.
	// Golden-angle hue spacing adds colors without cycling a fixed swatch list.
	function categoryColor(categoryId: string) {
		const index = categoryIds.indexOf(categoryId)
		const hue = (130 + index * 137.507764) % 360
		return `oklch(72% 0.17 ${hue})`
	}
	const slices = $derived.by(() => {
		const totals = new Map<string, number>()
		for (const row of expenses)
			totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0) + row.amountMinor)
		return [...totals]
			.map(([key, value]) => ({
				key,
				value,
				label:
					categoryNames.get(key) ??
					m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) }),
				color: categoryColor(key)
			}))
			.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
	})
	const activeCategory = $derived(
		slices.some((slice) => slice.key === selectedCategory) ? selectedCategory : null
	)
	const visible = $derived(
		expenses.filter((row) => activeCategory === null || row.categoryId === activeCategory)
	)
	const total = $derived(slices.reduce((sum, slice) => sum + slice.value, 0))
	function preset(days: number) {
		start = daysAgo(days)
		end = todayDateOnly()
		selectedCategory = null
	}
	function select(key: string) {
		selectedCategory = activeCategory === key ? null : key
	}
	const id = $props.id()
</script>

{#snippet emptyNavigation()}{/snippet}

<PageLayout {navigation}>
	{#snippet pageHeading()}
		<div class="overview-header">
			<Heading level="h1">{m['navigation.overview']()}</Heading>
			<FilterPopovers>
				{#snippet search()}
					<InputText
						label={m['actions.search_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
						type="search"
						bind:value={query}
					/>
				{/snippet}
				{#snippet filters()}
					<DateRangeFilter
						{start}
						{end}
						onchange={(nextStart, nextEnd) => {
							start = nextStart
							end = nextEnd
							selectedCategory = null
						}}
						onpreset={preset}
					/>

					{#if currencies.length > 1}<label
							>{m['labels.currency']()}
							<select bind:value={selectedCurrency} onchange={() => (selectedCategory = null)}
								>{#each currencies as code (code)}<option value={code}>{code}</option
									>{/each}</select
							></label
						>{/if}
					<Select
						label={m['actions.filter_subject']({ subject: m['nouns.category']({ count: 1 }) })}
						value={selectedCategory ?? ''}
						onchange={(event) => (selectedCategory = event.currentTarget.value || null)}
					>
						<option value=""
							>{m['labels.all_subjects']({ subjects: m['nouns.category']({ count: 2 }) })}</option
						>
						{#each [...categoryNames] as [key, name] (key)}<option value={key}>{name}</option
							>{/each}
					</Select>
				{/snippet}
			</FilterPopovers>
		</div>
	{/snippet}

	<section class="expense-overview" aria-labelledby={`${id}-title`}>
		<Heading level="h2" id={`${id}-title`}
			>{m['labels.subjects_by_subject']({
				subjects: m['nouns.expense']({ count: 2 }),
				subject: m['nouns.category']({ count: 1 })
			})}</Heading
		>
		{#if !validRange}<p role="status">{m['errors.date_range_invalid']()}</p>
		{:else if expenses.length === 0}<Text
				>{m['labels.no_subjects_in_period']({ subjects: m['nouns.expense']({ count: 0 }) })}</Text
			>
		{:else}
			<div class="results">
				<div>
					<Text
						>{m['labels.total_subject_amount']({
							subject: m['nouns.expense']({ count: 2 }),
							amount: formatMoney(total, currency, getLocale())
						})}</Text
					>
					{#if total > 0}
						<div class="chart" aria-label={m['overview_expenses.chart']()}>
							{#key JSON.stringify(categoryIds)}
								<ExpensePieChart
									data={categoryIds.map((key) => ({
										key,
										value: slices.find((slice) => slice.key === key)?.value ?? 0,
										color: categoryColor(key)
									}))}
									onselect={select}
								/>
							{/key}
						</div>
					{/if}
					<CategoryLegend
						items={slices}
						selectedKey={activeCategory}
						{currency}
						allLabel={m['labels.all_subjects']({ subjects: m['nouns.category']({ count: 2 }) })}
						onselect={select}
						onclear={() => (selectedCategory = null)}
					/>
				</div>
				<section aria-labelledby={`${id}-transactions`}>
					<Heading level="h3" id={`${id}-transactions`}
						>{activeCategory
							? slices.find((slice) => slice.key === activeCategory)?.label
							: m['labels.subjects_in_period']({
									subjects: m['nouns.expense']({ count: 2 })
								})}</Heading
					>
					<TransactionItems
						transactions={visible}
						{categoryNames}
						{tagNamesByTransaction}
						transactionHref={(transactionId) =>
							`${EXPENSES_PATH}/${encodeURIComponent(transactionId)}`}
					/>
				</section>
			</div>
		{/if}
	</section>
</PageLayout>

<style>
	section {
		min-inline-size: 0;
	}
	.expense-overview {
		container: expense-overview / inline-size;
	}
	.overview-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dui-spacing-md);
		justify-content: space-between;
	}
	.results {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--dui-spacing-lg, 2rem);
		align-items: start;
	}
	.chart {
		block-size: 20rem;
	}
	@container expense-overview (min-width: 48rem) {
		.results {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
</style>
