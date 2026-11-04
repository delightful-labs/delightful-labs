<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import { FloatingActionButton, Icon, InputText } from '#lib'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'

	const { Story } = defineMeta({
		title: 'Actions/FloatingActionButton',
		component: FloatingActionButton,
		tags: ['autodocs'],
		args: { 'aria-label': 'Add an item', title: 'Add an item' }
	})
</script>

<script lang="ts">
	let actions = $state(0)
	let submissions = $state(0)
</script>

<Story name="Default">
	{#snippet template(args)}
		<FloatingActionButton {...args} onclick={() => (actions += 1)}
			><Icon icon={AddIcon} /></FloatingActionButton
		>
		<p role="status">Actions: {actions}</p>
	{/snippet}
</Story>
<Story name="Disabled" args={{ disabled: true }}>
	{#snippet template(args)}
		<FloatingActionButton {...args}
			><Icon icon={AddIcon} /></FloatingActionButton
		>
	{/snippet}
</Story>
<Story name="Form submission">
	{#snippet template()}
		<form
			onsubmit={(event) => {
				event.preventDefault()
				submissions += 1
			}}
		>
			<InputText label="Item name" required />
			<FloatingActionButton aria-label="Save item" type="submit"
				><Icon icon={AddIcon} /></FloatingActionButton
			>
		</form>
		<p role="status">Submissions: {submissions}</p>
	{/snippet}
</Story>
