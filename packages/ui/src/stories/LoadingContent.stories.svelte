<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import { Button, InputText, LoadingContent } from '#lib'

	const { Story } = defineMeta({
		title: 'Feedback/LoadingContent',
		component: LoadingContent,
		tags: ['autodocs'],
		args: { text: 'Loading content' }
	})
</script>

<script lang="ts">
	let loading = $state(true)
	let draft = $state('Retained draft')
</script>

<Story name="Retained content">
	{#snippet template(args)}
		<div class="example">
			<Button type="button" onclick={() => (loading = !loading)}>
				{loading ? 'Finish loading' : 'Start loading'}
			</Button>
			<LoadingContent
				{...args}
				{loading}
				role="region"
				aria-label="Editable content"
			>
				<InputText label="Draft" bind:value={draft} />
				<Button type="button">Save draft</Button>
			</LoadingContent>
			<a href="#after-content">Continue after content</a>
		</div>
	{/snippet}
</Story>
<Story name="Standalone" />
<Story
	name="Error"
	args={{ text: 'Content could not be opened', variant: 'error' }}
/>

<style>
	.example {
		display: grid;
		gap: 1rem;
		max-inline-size: 30rem;
	}
</style>
