<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Text from '#lib/Components/Text.svelte'

	const { Story } = defineMeta({
		title: 'Typography/Text',
		component: Text,
		tags: ['autodocs']
	})
</script>

<Story name="Default">
	{#snippet template(args)}
		<Text as={args.as} size={args.size} align={args.align}
			>Manage your account preferences.</Text
		>
	{/snippet}
</Story>

<Story name="Sizes">
	{#snippet template(args)}
		<div style="display: grid; gap: var(--dui-spacing-xs, 0.5rem)">
			<Text as={args.as} size="xs">Extra small — xs</Text>
			<Text as={args.as} size="sm">Small — sm</Text>
			<Text as={args.as} size="md">Medium — md</Text>
			<Text as={args.as} size="lg">Large — lg</Text>
			<Text as={args.as} size="xl">Extra large — xl</Text>
			<Text as={args.as} size="xxl">Extra extra large — xxl</Text>
		</div>
	{/snippet}
</Story>

<Story name="Inline" args={{ as: 'span', size: 'sm' }}>
	{#snippet template(args)}
		<p>
			Last saved <Text as={args.as} size={args.size} align={args.align}
				>a moment ago</Text
			>.
		</p>
	{/snippet}
</Story>

<Story name="Alignment" args={{ align: 'center' }}>
	{#snippet template(args)}
		<div style="width: 100%">
			<Text size={args.size} align={args.align}
				>Manage your account preferences.</Text
			>
		</div>
	{/snippet}
</Story>

<Story name="Word wrapping">
	{#snippet template()}
		<div style="width: 8ch; font-family: monospace">
			<Text>alpha beta gamma</Text>
			<Text>uninterruptedword</Text>
		</div>
	{/snippet}
</Story>
