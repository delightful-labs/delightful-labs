<script lang="ts">
	import TransactionListItem from './TransactionListItem.svelte'
	import type { TransactionRow } from '#lib/schema.js'
	let {
		transactions,
		categoryNames,
		tagNamesByTransaction,
		transactionHref
	}: {
		transactions: readonly TransactionRow[]
		categoryNames: ReadonlyMap<string, string>
		tagNamesByTransaction: ReadonlyMap<string, readonly string[]>
		transactionHref: (id: string) => string
	} = $props()
</script>

<ul class="transactions" aria-live="polite">
	{#each transactions as transaction (transaction.id)}<TransactionListItem
			{transaction}
			href={transactionHref(transaction.id)}
			categoryName={categoryNames.get(transaction.categoryId)}
			tagNames={tagNamesByTransaction.get(transaction.id) ?? []}
		/>{/each}
</ul>

<style>
	.transactions {
		list-style: none;
		padding: 0;
	}
</style>
