<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'
	import { SwipeActions, Text, Button } from '#lib'
	import type { SwipeActionChosen } from '#lib/Components/internal/swipe-actions.js'

	function controls({
		children,
		...props
	}: ComponentProps<typeof SwipeActions>) {
		void children
		return props
	}

	const { Story } = defineMeta({
		title: 'Layout/SwipeActions',
		component: SwipeActions,
		args: {
			actionsLabel: 'Actions for Building a local library',
			leftActions: [
				{ id: 'archive', label: 'Archive' },
				{
					id: 'delete',
					label: 'Delete',
					variant: 'destructive',
					dismissOnSwipe: true
				}
			],
			rightActions: [
				{ id: 'favorite', label: 'Favorite' },
				{ id: 'unread', label: 'Mark unread' }
			]
		}
	})
</script>

<script lang="ts">
	let choice = $state<SwipeActionChosen>()
	let disabled = $state(false)
	let choiceCount = $state(0)
	let dismissRow = $state<{ reset: () => void }>()
	function chosen(next: SwipeActionChosen) {
		choice = next
		choiceCount += 1
	}
</script>

{#snippet article()}
	<a class="article" href="#saved-article">
		<Text as="span" size="sm"><strong>Building a local library</strong></Text>
		<Text as="span" size="sm">A saved article with notes and highlights.</Text>
	</a>
{/snippet}

{#snippet result()}
	<output hidden aria-label="Chosen action">
		{choice
			? `${choice.id} / ${choice.side} / ${choice.source}`
			: 'No action chosen'}
	</output>
	<output hidden aria-label="Action count">{choiceCount}</output>
{/snippet}

<Story name="Both directions">
	{#snippet template(args)}
		<div class="example">
			<ul aria-label="Saved articles">
				<li>
					<SwipeActions
						bind:this={dismissRow}
						{...controls(args)}
						onactionchosen={chosen}>{@render article()}</SwipeActions
					>
				</li>
			</ul>
			<Button onclick={() => dismissRow?.reset()}>Reset item</Button>
			{@render result()}
		</div>
	{/snippet}
</Story>

<Story
	name="Three progressive actions"
	args={{
		leftActions: [
			{ id: 'archive', label: 'Archive' },
			{ id: 'trash', label: 'Move to trash', variant: 'destructive' },
			{
				id: 'delete',
				label: 'Delete permanently',
				variant: 'destructive',
				dismissOnSwipe: true
			}
		]
	}}
>
	{#snippet template(args)}
		<div class="example">
			<SwipeActions
				bind:this={dismissRow}
				{...controls(args)}
				onactionchosen={chosen}>{@render article()}</SwipeActions
			>
			<Button onclick={() => dismissRow?.reset()}>Reset item</Button>
			{@render result()}
		</div>
	{/snippet}
</Story>

<Story
	name="Wrapping labels"
	args={{
		leftActions: [
			{ id: 'archive', label: 'Archive for later' },
			{ id: 'trash', label: 'Move to trash', variant: 'destructive' },
			{ id: 'delete', label: 'Delete permanently', variant: 'destructive' }
		],
		rightActions: [
			{ id: 'remind', label: 'Remind me later' },
			{ id: 'unread', label: 'Mark as unread' },
			{ id: 'remove', label: 'Remove from collection', variant: 'destructive' }
		]
	}}
>
	{#snippet template(args)}
		<div class="example">
			<SwipeActions {...controls(args)} onactionchosen={chosen}>
				<a class="article" href="#saved-article">
					<Text as="span" size="sm"
						><strong
							>Building a local library with notes and reading lists</strong
						></Text
					>
					<Text as="span" size="sm"
						>Keep saved articles, detailed notes and highlights together for
						your next reading session.</Text
					>
				</a>
			</SwipeActions>
			{@render result()}
		</div>
	{/snippet}
</Story>

<Story
	name="Dismiss on full swipe"
	args={{
		leftActions: [
			{ id: 'archive', label: 'Archive' },
			{
				id: 'trash',
				label: 'Trash',
				variant: 'destructive',
				dismissOnSwipe: true
			}
		],
		rightActions: [
			{ id: 'favorite', label: 'Favorite' },
			{ id: 'archive', label: 'Archive', dismissOnSwipe: true }
		]
	}}
>
	{#snippet template(args)}
		<div class="example">
			<ul aria-label="Saved articles">
				<li>
					<SwipeActions
						bind:this={dismissRow}
						{...controls(args)}
						onactionchosen={chosen}
					>
						{@render article()}
					</SwipeActions>
				</li>
			</ul>
			<Button onclick={() => dismissRow?.reset()}>Reset item</Button>
			{@render result()}
		</div>
	{/snippet}
</Story>

<Story name="One side" args={{ rightActions: [] }}>
	{#snippet template(args)}
		<div class="example">
			<SwipeActions {...controls(args)} onactionchosen={chosen}
				>{@render article()}</SwipeActions
			>
			{@render result()}
		</div>
	{/snippet}
</Story>

<Story
	name="Disabled actions"
	args={{
		leftActions: [
			{ id: 'archive', label: 'Archive', disabled: true },
			{ id: 'delete', label: 'Delete', variant: 'destructive' }
		]
	}}
>
	{#snippet template(args)}
		<div class="example">
			<SwipeActions {...controls(args)} onactionchosen={chosen}
				>{@render article()}</SwipeActions
			>
			{@render result()}
		</div>
	{/snippet}
</Story>

<Story name="Disable while swiping">
	{#snippet template(args)}
		<div class="example">
			<SwipeActions {...controls(args)} {disabled} onactionchosen={chosen}
				>{@render article()}</SwipeActions
			>
			<Button onclick={() => (disabled = !disabled)}
				>Toggle swipe actions</Button
			>
			{@render result()}
		</div>
	{/snippet}
</Story>

<Story name="Scrollable mobile list">
	{#snippet template(args)}
		<div class="example narrow">
			<div
				class="scroll-list"
				role="region"
				aria-label="Scrollable saved articles"
			>
				<ul aria-label="Saved articles">
					{#each Array.from({ length: 12 }, (_, index) => index + 1) as item (item)}
						<li>
							<SwipeActions
								{...controls(args)}
								actionsLabel={`Actions for article ${item}`}
								onactionchosen={chosen}
							>
								<a class="article" href={`#article-${item}`}>
									<Text as="span" size="sm"
										><strong>Saved article {item}</strong></Text
									>
									<Text as="span" size="sm"
										>Swipe horizontally or scroll vertically.</Text
									>
								</a>
							</SwipeActions>
						</li>
					{/each}
				</ul>
			</div>
			{@render result()}
		</div>
	{/snippet}
</Story>

<style>
	.example {
		display: grid;
		gap: 1rem;
		max-inline-size: 36rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li + li {
		border-block-start: 1px solid var(--dui-color-foreground, #000);
	}
	.article {
		display: grid;
		padding: 1rem;
		color: inherit;
		text-decoration: none;
	}
	.article:focus-visible {
		outline: 2px solid var(--dui-color-focus, #2563eb);
		outline-offset: -3px;
	}
	.narrow {
		max-inline-size: 22rem;
	}
	.scroll-list {
		max-block-size: 24rem;
		overflow-y: auto;
	}
</style>
