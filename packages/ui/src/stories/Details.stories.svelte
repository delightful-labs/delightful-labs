<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Details from '#lib/Components/Details.svelte'

	const { Story } = defineMeta({
		title: 'Disclosure/Details',
		component: Details,
		tags: ['autodocs'],
		args: { summary: 'Options' }
	})
</script>

<Story name="Inline">
	{#snippet template(args)}
		<Details {...args}><p>Additional information.</p></Details>
	{/snippet}
</Story>
<Story name="Absolute" args={{ position: 'absolute' }}>
	{#snippet template(args)}
		<Details {...args}><a href="#options">View options</a></Details>
	{/snippet}
</Story>

<Story name="Right caret" args={{ caretPosition: 'right' }}>
	{#snippet template(args)}
		<Details {...args}><p>Additional information.</p></Details>
	{/snippet}
</Story>
<Story name="Custom caret">
	{#snippet template(args)}
		<Details {...args}>
			{#snippet caret(open)}
				<span>{open ? '−' : '+'}</span>
			{/snippet}
			<p>Additional information.</p>
		</Details>
	{/snippet}
</Story>
