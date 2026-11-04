<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import { FloatingActionLink, Icon } from '#lib'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'

	const { Story } = defineMeta({
		title: 'Actions/FloatingActionLink',
		component: FloatingActionLink,
		tags: ['autodocs'],
		args: {
			href: '#new-item',
			'aria-label': 'Add an item',
			title: 'Add an item'
		}
	})
</script>

<Story name="Default">
	{#snippet template(args)}
		<FloatingActionLink {...args}><Icon icon={AddIcon} /></FloatingActionLink>
	{/snippet}
</Story>
<Story name="Scrolling content">
	{#snippet template(args)}
		<div class="scroll-area" role="region" aria-label="Scrollable content">
			{#each Array.from({ length: 20 }, (_, index) => index + 1) as row (row)}
				<p>Content row {row}</p>
			{/each}
			<FloatingActionLink {...args}><Icon icon={AddIcon} /></FloatingActionLink>
		</div>
	{/snippet}
</Story>

<style>
	.scroll-area {
		block-size: 20rem;
		overflow: auto;
	}
	.scroll-area p {
		padding-block: 1rem;
	}
</style>
