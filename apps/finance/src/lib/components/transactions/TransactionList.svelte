<script lang="ts" generics="Row extends TransactionListRow = TransactionRow">
	import type { ComponentProps } from 'svelte'
	import type { TransactionRow } from '../../schema.js'
	import {
		paginateTransactionGroups,
		type TransactionListRow
	} from '../../domain/transaction-groups.js'
	import View from './TransactionListView.svelte'
	let {
		groups,
		requestedPage,
		...props
	}: Omit<ComponentProps<typeof View<Row>>, 'page' | 'pageCount'> & { requestedPage: number } =
		$props()
	const pagination = $derived(paginateTransactionGroups(groups, requestedPage))
</script>

<View {...props} {...pagination} />
