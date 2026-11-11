<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Pagination from '#lib/Components/Pagination.svelte'
	import PaginationItem from '#lib/Components/PaginationItem.svelte'

	const { Story } = defineMeta({
		title: 'Navigation/Pagination',
		component: Pagination,
		tags: ['autodocs'],
		args: { label: 'Search results pages' }
	})
</script>

<Story name="Page navigation">
	{#snippet template(args)}
		<Pagination {...args}>
			<PaginationItem label="Previous page" href="#">‹</PaginationItem>
			<PaginationItem label="Page 3" href="#">3</PaginationItem>
			<PaginationItem label="Page 4" href="#" current>4</PaginationItem>
			<PaginationItem label="Page 5" href="#">5</PaginationItem>
			<PaginationItem label="More pages" ellipsis>…</PaginationItem>
			<PaginationItem label="Page 12" href="#">12</PaginationItem>
			<PaginationItem label="Next page" href="#">›</PaginationItem>
		</Pagination>
	{/snippet}
</Story>

<Story name="Disabled boundary controls">
	{#snippet template(args)}
		<Pagination {...args}>
			<PaginationItem label="Previous page" disabled>‹</PaginationItem>
			<PaginationItem label="Page 1" href="#" current>1</PaginationItem>
			<PaginationItem label="Page 2" href="#">2</PaginationItem>
			<PaginationItem label="Page 3" href="#">3</PaginationItem>
			<PaginationItem label="Next page" href="#">›</PaginationItem>
		</Pagination>
	{/snippet}
</Story>
