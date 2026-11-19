<script lang="ts">
	import { untrack, type Snippet } from 'svelte'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { EXPENSES_PATH } from '#lib/domain/transaction-kind.js'
	import ExpensePieChart from './ExpensePieChart.svelte'
	import { Heading, Text, InputText, Select, StatusMessage } from 'delightful-ui'
	import FilterPopovers from '../filters/FilterPopovers.svelte'
	import DateRangeFilter from '../filters/DateRangeFilter.svelte'
	import CategoryLegend from './CategoryLegend.svelte'
	import TransactionListView from '../transactions/TransactionListView.svelte'
	import type { WorkerOverviewView } from '#lib/contracts/worker-application.js'
	import type { TransactionListFilters } from '#lib/filters/transaction-list-filters.js'
	import type { OverviewFilters } from '#lib/filters/overview-filters.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import { formatSignedMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		navigation = emptyNavigation,
		data,
		filters = null,
		scope,
		onfilterschange,
		onPage,
		pageHref
	}: {
		navigation?: Snippet
		data: WorkerOverviewView | null
		filters?: OverviewFilters | null
		scope: string
		onfilterschange: (filters: TransactionListFilters) => void
		onPage: (page: number) => void
		pageHref: (page: number) => string
	} = $props()
	function daysAgo(days: number) {
		const date = new Date()
		date.setDate(date.getDate() - (days - 1))
		return todayDateOnly(date)
	}
	let query = $state(''),
		start = $state(daysAgo(30)),
		end = $state(todayDateOnly())
	let selectedCategory = $state<string | null>(null),
		selectedCurrency = $state('USD')
	$effect(() => {
		if (!filters) return
		start = filters.start
		end = filters.end
		selectedCategory = filters.categoryId
		selectedCurrency = filters.currency
	})
	$effect(() => {
		void scope
		const values = {
			query,
			start,
			end,
			categoryId: selectedCategory ?? '',
			currency: selectedCurrency
		}
		untrack(() => onfilterschange(values))
	})
	const validRange = $derived(data?.rangeValid ?? true)
	const currencies = $derived(data?.currencies ?? [])
	const currency = $derived(data?.currency ?? selectedCurrency)
	const categoryIds = $derived(data?.categoryIds ?? [])
	const categoryNames = $derived(new Map(data?.categories ?? []))
	const tagNamesByTransaction = $derived(new Map(data?.tags ?? []))
	const groups = $derived(
		data?.groups.map((group) => ({ ...group, totals: new Map(group.totals) })) ?? []
	)
	function categoryColor(categoryId: string) {
		const hue = (130 + categoryIds.indexOf(categoryId) * 137.507764) % 360
		return `oklch(72% 0.17 ${hue})`
	}
	const slices = $derived(
		data?.slices.map((slice) => ({
			...slice,
			label:
				slice.name ??
				m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) }),
			color: categoryColor(slice.key)
		})) ?? []
	)
	const activeCategory = $derived(data?.activeCategory ?? null)
	const total = $derived(data?.total ?? 0n)
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
						onchange={(change) => {
							start = change.start ?? start
							end = change.end ?? end
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
		{#if !data}<StatusMessage
				variant="loading"
				text={m['status.loading_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
			/>
		{:else if !validRange}<p role="status">{m['errors.date_range_invalid']()}</p>
		{:else if !data.hasExpenses}<Text
				>{m['labels.no_subjects_in_period']({ subjects: m['nouns.expense']({ count: 0 }) })}</Text
			>
		{:else}
			<div class="results">
				<div>
					<Text
						>{m['labels.total_subject_amount']({
							subject: m['nouns.expense']({ count: 2 }),
							amount: formatSignedMoney(total, currency, getLocale())
						})}</Text
					>
					{#if total > 0n}
						<div class="chart" aria-label={m['overview_expenses.chart']()}>
							{#key JSON.stringify(categoryIds)}
								<ExpensePieChart
									data={categoryIds.map((key) => ({
										key,
										// Number is only a chart geometry input; displayed money stays exact bigint.
										value: Number(slices.find((slice) => slice.key === key)?.value ?? 0n),
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
					<TransactionListView
						{groups}
						page={data.page}
						pageCount={data.pageCount}
						{onPage}
						{pageHref}
						noAccountsSelected={false}
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
