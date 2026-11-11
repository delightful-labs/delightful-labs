<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Popover from '#lib/Components/Popover.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Disclosure/Popover',
		component: Popover,
		tags: ['autodocs'],
		args: { id: 'information' }
	})
</script>

<Story name="Information">
	{#snippet template(args)}
		<Button popovertarget={args.id}>About amounts</Button>
		<Popover {...args}><p>Enter the total amount, including tax.</p></Popover>
	{/snippet}
</Story>

<Story name="Interactive content" args={{ id: 'interactive-information' }}>
	{#snippet template(args)}
		<Button popovertarget={args.id}>More information</Button>
		<Button popovertarget={args.id}>Another trigger</Button>
		<Popover {...args}>
			<p>Additional help is available.</p>
			<a href="https://example.com">Read more</a>
			<Button popovertarget={args.id} popovertargetaction="hide">Close</Button>
		</Popover>
	{/snippet}
</Story>
