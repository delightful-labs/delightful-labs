<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Dialog from '#lib/Components/Dialog.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Disclosure/Dialog',
		component: Dialog,
		args: { heading: 'Review changes' },
		argTypes: { open: { control: false } }
	})
</script>

<script lang="ts">
	let open = $state(false)
</script>

<Story name="Default">
	{#snippet template(args)}
		<Button onclick={() => (open = true)}>Open dialog</Button>
		<Dialog {...args} bind:open>
			<p>Review your changes before continuing.</p>
			<form method="dialog">
				<Button type="submit" value="close">Close</Button>
			</form>
		</Dialog>
	{/snippet}
</Story>

<Story name="Closedby any" args={{ closedby: 'any' }}>
	{#snippet template(args)}
		<Button onclick={() => (open = true)}>Open dialog</Button>
		<Dialog {...args} bind:open>
			<p>Click or tap outside the dialog to close it.</p>
			<form method="dialog">
				<Button type="submit" value="close">Close</Button>
			</form>
		</Dialog>
	{/snippet}
</Story>
