<script lang="ts">
	import type { Snippet } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import type { TransactionListFilters } from '#lib/filters/transaction-list-filters.js'
	import DateRangeFilter from './DateRangeFilter.svelte'
	import { Heading, InputText, Select } from 'delightful-ui'
	import FilterPopovers from './FilterPopovers.svelte'
	let {
		title,
		closeControl,
		headingLevel = 'h1',
		value,
		categories,
		currencies,
		onchange
	}: {
		title?: string
		closeControl?: Snippet | undefined
		headingLevel?: 'h1' | 'h2'
		value: TransactionListFilters
		categories: ReadonlyMap<string, string>
		currencies: readonly string[]
		onchange: (value: TransactionListFilters) => void
	} = $props()
</script>

<div class="filter-header">
	{#if title}<Heading level={headingLevel}>{title}</Heading>{/if}
	<FilterPopovers trailing={closeControl}>
		{#snippet search()}
			<InputText
				label={m['actions.search_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
				type="search"
				value={value.query}
				oninput={(event) => onchange({ ...value, query: event.currentTarget.value })}
			/>
		{/snippet}
		{#snippet filters()}
			<DateRangeFilter
				start={value.start}
				end={value.end}
				onchange={(start, end) => onchange({ ...value, start, end })}
				onpreset={(days) => {
					const date = new Date()
					date.setDate(date.getDate() - (days - 1))
					onchange({ ...value, start: todayDateOnly(date), end: todayDateOnly() })
				}}
			/>
			<Select
				label={m['actions.filter_subject']({ subject: m['nouns.category']({ count: 1 }) })}
				value={value.categoryId}
				onchange={(event) => onchange({ ...value, categoryId: event.currentTarget.value })}
			>
				<option value=""
					>{m['labels.all_subjects']({ subjects: m['nouns.category']({ count: 2 }) })}</option
				>
				{#each [...categories] as [id, name] (id)}<option value={id}>{name}</option>{/each}
			</Select>
			{#if currencies.length > 1}
				<Select
					label={m['actions.filter_subject']({ subject: m['labels.currency']() })}
					value={value.currency}
					onchange={(event) => onchange({ ...value, currency: event.currentTarget.value })}
				>
					<option value="">{m['archive_filter.all']()}</option>
					{#each currencies as code (code)}<option value={code}>{code}</option>{/each}
				</Select>
			{/if}
		{/snippet}
	</FilterPopovers>
</div>

<style>
	.filter-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--dui-spacing-xs);
		min-inline-size: 0;
	}
</style>
