<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import LoadingSpinner from '#lib/Components/LoadingSpinner.svelte'

	const { Story } = defineMeta({
		title: 'Feedback/LoadingSpinner',
		component: LoadingSpinner,
		tags: ['autodocs'],
		args: { text: 'Loading' }
	})
</script>

<Story name="Default" />
<Story name="Decorative">
	{#snippet template()}
		<LoadingSpinner role="presentation" aria-hidden="true" />
	{/snippet}
</Story>
<Story
	name="Compact"
	args={{
		text: 'Saving changes',
		style:
			'--dui-loading-spinner-size: 32px; --dui-loading-spinner-border-width: 2px; --dui-loading-spinner-color: var(--dui-color-accent);'
	}}
/>
