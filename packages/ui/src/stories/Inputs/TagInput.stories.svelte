<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import TagInput from '#lib/Components/Inputs/TagInput.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Tags',
		component: TagInput,
		tags: ['autodocs'],
		args: {
			label: 'Tags',
			name: 'tags',
			addLabel: 'Add tag',
			removeLabel: (tag: string) => `Remove ${tag}`,
			selectedTagsLabel: 'Selected tags',
			addedMessage: (tag: string) => `${tag} added`,
			removedMessage: (tag: string) => `${tag} removed`,
			duplicateMessage: (tag: string) => `${tag} is already added`,
			placeholder: 'Enter a tag'
		}
	})
</script>

<script lang="ts">
	let tags = $state<string[] | undefined>()
	let submitted = $state('No submission yet.')

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		submitted = JSON.stringify(new FormData(event.currentTarget).getAll('tags'))
	}
</script>

<Story name="Default" />
<Story
	name="Instructions"
	args={{
		instructions:
			'Press Enter to add a tag. Use Arrow keys to choose a suggestion.',
		suggestions: ['Work', 'Personal']
	}}
/>
<Story
	name="Error"
	args={{ errorMessage: 'Add at least one tag before continuing.' }}
/>
<Story
	name="Remove several tags"
	args={{ defaultValue: ['Work', 'Personal', 'Recipes'] }}
/>
<Story
	name="Suggestions"
	args={{
		suggestions: [
			'Work',
			'Personal',
			'Recipes',
			'Reading',
			'Research',
			'Travel'
		],
		defaultValue: ['Work']
	}}
/>
<Story
	name="Custom normalization"
	args={{
		// Example policy only; applications can supply their own Unicode implementation.
		normalizeTag: (tag: string) =>
			tag.normalize('NFC').toLowerCase().replaceAll('ß', 'ss'),
		defaultValue: ['Straße', 'Café'],
		suggestions: [
			'Straße',
			'STRASSE',
			'Café',
			'Cafe\u0301',
			'Fußball',
			'FUSSBALL',
			'Café Notes'
		]
	}}
/>
<Story name="Disabled" args={{ disabled: true, defaultValue: ['Work'] }} />
<Story name="Readonly" args={{ readonly: true, defaultValue: ['Personal'] }} />
<Story
	name="Wrapping"
	args={{
		defaultValue: [
			'Work',
			'Personal',
			'A very long tag that wraps on narrow screens'
		]
	}}
/>

<Story name="Binding and form submission" args={{ defaultValue: ['Work'] }}>
	{#snippet template(args)}
		<form onsubmit={submit} onreset={() => (submitted = 'No submission yet.')}>
			<TagInput {...args} bind:value={tags} />
			<div class="controls">
				<Button onclick={() => (tags = ['Personal'])}
					>Set tags from parent</Button
				>
				<Button type="submit">Submit</Button>
				<Button type="reset">Reset</Button>
			</div>
			<output aria-label="Current tags">{JSON.stringify(tags)}</output>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<style>
	form {
		display: grid;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
		max-inline-size: 32rem;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}
</style>
