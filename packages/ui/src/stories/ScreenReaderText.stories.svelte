<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import ScreenReaderText from '#lib/Components/ScreenReaderText.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Accessibility/ScreenReaderText',
		component: ScreenReaderText
	})
</script>

<Story name="Supplementary label">
	{#snippet template(args)}
		<Button
			>Save <ScreenReaderText {...args}>changes to this item</ScreenReaderText
			></Button
		>
	{/snippet}
</Story>
