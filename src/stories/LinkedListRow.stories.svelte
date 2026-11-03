<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import { LinkedListRow, Text } from '#lib'

	const { Story } = defineMeta({
		title: 'Layout/LinkedListRow',
		component: LinkedListRow,
		tags: ['autodocs'],
		args: { href: '#saved-article', label: 'Read Building a local library' }
	})
</script>

<Story name="Articles">
	{#snippet template(args)}
		<ul class="rows" aria-label="Saved articles">
			<LinkedListRow href={args.href} label={args.label}>
				<Text as="span" size="sm"
					><strong>Building a local library</strong></Text
				>
				<Text as="span" size="sm"
					>A saved article with notes and highlights.</Text
				>
				{#snippet trailing()}<Text as="span" size="sm">35%</Text>{/snippet}
			</LinkedListRow>
			<LinkedListRow
				href="#another-article"
				label="Read An article without progress"
			>
				<Text as="span" size="sm">An article without progress</Text>
			</LinkedListRow>
		</ul>
	{/snippet}
</Story>
<Story name="Transactions">
	{#snippet template()}
		<ul class="rows" aria-label="Transactions">
			<LinkedListRow
				href="#transaction"
				label="Transaction details: Groceries, Weekly shop, $42.00"
			>
				<Text as="span" size="sm"><strong>Groceries</strong></Text>
				<Text as="span" size="sm"><em>Weekly shop</em></Text>
				{#snippet trailing()}<Text as="span" size="sm">$42.00</Text>{/snippet}
			</LinkedListRow>
		</ul>
	{/snippet}
</Story>
<Story name="Long content">
	{#snippet template()}
		<div class="narrow">
			<ul class="rows" aria-label="Saved articles">
				<LinkedListRow
					href="#long-article"
					label="Read A longer article title about keeping a personal library available across devices"
				>
					<Text as="span" size="sm"
						><strong
							>A longer article title about keeping a personal library available
							across devices</strong
						></Text
					>
					<Text as="span" size="sm"
						>An additional description and
						source.example/averylongunbrokensourceidentifier</Text
					>
					{#snippet trailing()}<Text as="span" size="sm">100%</Text>{/snippet}
				</LinkedListRow>
			</ul>
		</div>
	{/snippet}
</Story>

<style>
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.narrow {
		max-inline-size: 16rem;
	}
</style>
