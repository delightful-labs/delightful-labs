<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Heading from '#lib/Components/Heading.svelte'

	const { Story } = defineMeta({
		title: 'Typography/Heading',
		component: Heading,
		tags: ['autodocs']
	})
</script>

<Story name="Default">
	{#snippet template(args)}
		<Heading level={args.level} size={args.size} align={args.align}
			>Account settings</Heading
		>
	{/snippet}
</Story>

<Story name="Levels">
	{#snippet template(args)}
		<div style="display: grid; gap: var(--dui-spacing-xs, 0.5rem)">
			<Heading size={args.size} align={args.align} level="h1"
				>Page title — xxl</Heading
			>
			<Heading size={args.size} align={args.align} level="h2"
				>Section title — xl</Heading
			>
			<Heading size={args.size} align={args.align} level="h3"
				>Group title — lg</Heading
			>
			<Heading size={args.size} align={args.align} level="h4"
				>Panel title — md</Heading
			>
			<Heading size={args.size} align={args.align} level="h5"
				>Subsection title — sm</Heading
			>
			<Heading size={args.size} align={args.align} level="h6"
				>Detail title — xs</Heading
			>
		</div>
	{/snippet}
</Story>

<Story name="Size override" args={{ level: 'h1', size: 'sm' }}>
	{#snippet template(args)}
		<Heading level={args.level} size={args.size} align={args.align}
			>A small page title</Heading
		>
	{/snippet}
</Story>

<Story name="Alignment" args={{ align: 'center' }}>
	{#snippet template(args)}
		<div style="width: 100%">
			<Heading size={args.size} align={args.align}>Account settings</Heading>
		</div>
	{/snippet}
</Story>
