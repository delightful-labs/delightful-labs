<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import InputImage from '#lib/Components/Inputs/InputImage.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Image',
		component: InputImage,
		tags: ['autodocs'],
		args: { label: 'Image', name: 'image', removeLabel: 'Remove image' }
	})
</script>

<script lang="ts">
	let value = $state<File | null>(null)
	let disabled = $state(false)
	let mounted = $state(true)
	let result = $state('No submission yet.')
</script>

<Story name="Default" />
<Story name="Required" args={{ required: true }} />
<Story name="Disabled" args={{ disabled: true }} />
<Story name="Bound form">
	{#snippet template(args)}
		<form
			onsubmit={(event) => {
				event.preventDefault()
				const file = new FormData(event.currentTarget).get('image')
				result =
					file instanceof File
						? `${file.name}: ${file.size} bytes`
						: 'No image field'
			}}
		>
			{#if mounted}
				<InputImage {...args} bind:value {disabled} required />
			{/if}
			<p role="status" aria-label="Selected image">
				{value?.name ?? 'No image'}
			</p>
			<button type="submit">Submit</button>
			<button type="reset">Reset</button>
			<button type="button" onclick={() => (value = null)}>Clear image</button>
			<button
				type="button"
				onclick={() => {
					value = new File(['invalid image'], 'parent.png', {
						type: 'image/png'
					})
				}}>Set image</button
			>
			<button type="button" onclick={() => (disabled = !disabled)}
				>Toggle disabled</button
			>
			<button type="button" onclick={() => (mounted = !mounted)}
				>Toggle component</button
			>
			<pre aria-live="polite">{result}</pre>
		</form>
	{/snippet}
</Story>
