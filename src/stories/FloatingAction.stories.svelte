<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import { FloatingAction, InputText } from '#lib'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'

	const { Story } = defineMeta({
		title: 'Actions/FloatingAction',
		component: FloatingAction,
		tags: ['autodocs'],
		args: { label: 'Add an item', icon: AddIcon }
	})
</script>

<script lang="ts">
	let actions = $state(0)
	let submissions = $state(0)
</script>

<Story name="Link" args={{ href: '#new-item' }} />
<Story name="Button">
	{#snippet template()}
		<FloatingAction
			label="Add an item"
			icon={AddIcon}
			onclick={() => (actions += 1)}
		/>
		<p role="status">Actions: {actions}</p>
	{/snippet}
</Story>
<Story name="Disabled" args={{ disabled: true }} />
<Story name="Form submission">
	{#snippet template()}
		<form
			onsubmit={(event) => {
				event.preventDefault()
				submissions += 1
			}}
		>
			<InputText label="Item name" required />
			<FloatingAction label="Save item" icon={AddIcon} type="submit" />
		</form>
		<p role="status">Submissions: {submissions}</p>
	{/snippet}
</Story>
<Story name="Scrolling content">
	{#snippet template()}
		<div class="scroll-area" role="region" aria-label="Scrollable content">
			{#each Array.from({ length: 20 }, (_, index) => index + 1) as row (row)}
				<p>Content row {row}</p>
			{/each}
			<FloatingAction href="#new-item" label="Add an item" icon={AddIcon} />
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
