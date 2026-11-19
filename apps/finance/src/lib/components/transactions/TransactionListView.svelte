<script lang="ts" generics="Row extends TransactionListRow = TransactionRow">
	import type { Snippet } from 'svelte'
	import type { TransactionRow } from '#lib/queries.js'
	import { Details, Heading, Pagination, Text } from 'delightful-ui'
	import Icon from '../navigation/AppIcon.svelte'
	import ChevronDown from 'tdesign-icons-svg/src/chevron-down.svg?component'
	import ChevronRight from 'tdesign-icons-svg/src/chevron-right.svg?component'
	import PaginationLink from '../navigation/PaginationLink.svelte'
	import SplitRow from '../shared/SplitRow.svelte'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { formatSignedMoney } from '#lib/domain/money.js'
	import type { TransactionDay, TransactionListRow } from '#lib/domain/transaction-groups.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionListItem from './TransactionListItem.svelte'

	let {
		groups,
		categoryNames,
		tagNamesByTransaction,
		noAccountsSelected,
		page,
		pageCount,
		onPage,
		pageHref,
		transactionHref,
		item,
		showTotals = true
	}: {
		groups: readonly TransactionDay<Row>[]
		categoryNames: ReadonlyMap<string, string>
		tagNamesByTransaction: ReadonlyMap<string, readonly string[]>
		noAccountsSelected: boolean
		page: number
		pageCount: number
		onPage?: ((page: number) => void) | undefined
		pageHref: (page: number) => string
		transactionHref: (id: string) => string
		item?: Snippet<[Row]>
		showTotals?: boolean
	} = $props()
	function selectPage(event: MouseEvent, number: number) {
		if (
			!onPage ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return
		event.preventDefault()
		onPage(number)
	}
	const pageNumbers = $derived.by(() => {
		// Five slots, including ellipses. Near either boundary, use the spare
		// slots for page numbers so navigation never shrinks as the page changes.
		if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1)
		const start = page <= 3 ? 2 : page >= pageCount - 2 ? pageCount - 2 : page
		const end = page <= 3 ? 3 : page >= pageCount - 2 ? pageCount - 1 : page
		return [1, ...Array.from({ length: end - start + 1 }, (_, index) => start + index), pageCount]
	})
	const listId = $props.id()
	const dateFormatter = $derived(
		new Intl.DateTimeFormat(getLocale(), {
			weekday: 'short',
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		})
	)
</script>

{#if noAccountsSelected}
	<Text size="sm">{m['transactions.no_accounts_selected']()}</Text>
{:else if groups.length === 0}
	<Text size="sm">{m['transactions.empty.title']()}</Text>
{:else}
	<div class="transaction-list">
		{#each groups as group (group.bookedOn)}
			<section aria-labelledby={`${listId}-${group.bookedOn}`}>
				<Details open caretPosition="right">
					{#snippet caret(expanded)}
						<span class="caret"><Icon icon={expanded ? ChevronDown : ChevronRight} /></span>
					{/snippet}
					{#snippet summary()}
						<SplitRow>
							<Heading level="h2" size="md" id={`${listId}-${group.bookedOn}`}>
								<time datetime={group.bookedOn}
									>{dateFormatter.format(new Date(`${group.bookedOn}T00:00:00Z`))}</time
								>
							</Heading>
							{#snippet trailing()}
								<div class="totals">
									{#each showTotals ? [...group.totals] : [] as [currency, amount] (currency)}
										<Text
											size="sm"
											as="span"
											aria-label={m['transactions.daily_total_amount']({
												amount: formatSignedMoney(amount, currency, getLocale())
											})}
										>
											{formatSignedMoney(amount, currency, getLocale())}
										</Text>
									{/each}
								</div>
							{/snippet}
						</SplitRow>
					{/snippet}
					<ul class="entries">
						{#each group.transactions as transaction (transaction.id)}
							{#if item}
								{@render item(transaction)}
							{:else}
								<TransactionListItem
									href={transactionHref(transaction.id)}
									{transaction}
									categoryName={categoryNames.get(transaction.categoryId)}
									tagNames={tagNamesByTransaction.get(transaction.id) ?? []}
								/>
							{/if}
						{/each}
					</ul>
				</Details>
			</section>
		{/each}
		{#if pageCount > 1}
			<Pagination label={m['transactions.pagination.label']()}>
				<PaginationLink
					label={m['labels.previous_subject']({ subject: m['nouns.page']({ count: 1 }) })}
					href={pageHref(page - 1)}
					onclick={(event) => selectPage(event, page - 1)}
					disabled={page === 1}>‹</PaginationLink
				>
				{#each pageNumbers as number, index (number)}
					{#if index > 0 && number - (pageNumbers[index - 1] ?? number) > 1}
						<PaginationLink
							label={m['labels.more_subjects']({ subjects: m['nouns.page']({ count: 2 }) })}
							ellipsis>…</PaginationLink
						>
					{/if}
					<PaginationLink
						label={m['labels.page_number']({ number: number })}
						href={pageHref(number)}
						onclick={(event) => selectPage(event, number)}
						current={page === number}>{number}</PaginationLink
					>
				{/each}
				<PaginationLink
					label={m['labels.next_subject']({ subject: m['nouns.page']({ count: 1 }) })}
					href={pageHref(page + 1)}
					onclick={(event) => selectPage(event, page + 1)}
					disabled={page === pageCount}>›</PaginationLink
				>
			</Pagination>
		{/if}
	</div>
{/if}

<style>
	.transaction-list {
		display: grid;
		gap: var(--dui-spacing-md);
		min-inline-size: 0;
	}

	section {
		--dui-details-content-padding: 0;
		--dui-details-summary-padding: var(--dui-spacing-xs);
		--dui-details-caret-gap: var(--dui-spacing-md);
		--dui-details-summary-font-size: var(--dui-font-size-sm);
		--dui-heading-color: currentColor;
		--dui-text-color: currentColor;
		display: grid;
		gap: var(--dui-spacing-xs);
		min-inline-size: 0;
	}

	.caret {
		display: inline-grid;
		min-inline-size: 24px;
		place-items: center;
	}

	.entries {
		display: grid;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.totals {
		display: flex;
		gap: var(--dui-spacing-xs);
		flex-wrap: wrap;
	}
</style>
