<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import InputAvatar from '#lib/Components/Inputs/InputAvatar.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Avatar',
		component: InputAvatar,
		tags: ['autodocs'],
		args: { label: 'Avatar', name: 'avatar', removeLabel: 'Remove' }
	})
</script>

<script lang="ts">
	let value = $state<File | null>(null)
	let disabled = $state(false)
	let mounted = $state(true)
	let result = $state('No submission yet.')
</script>

<Story name="Default" />
<Story
	name="Custom labels"
	args={{
		label: 'Profile photo',
		uploadLabel: 'Choose photo',
		removeLabel: 'Delete photo'
	}}
/>
<Story name="Circle" args={{ shape: 'circle' }} />
<Story name="Required" args={{ required: true }} />
<Story
	name="Long labels"
	args={{
		uploadLabel: 'Upload a new profile photograph',
		removeLabel: 'Remove your profile photograph'
	}}
/>
<Story name="Disabled" args={{ disabled: true }} />
<Story name="Bound form">
	{#snippet template(args)}
		<form
			onsubmit={(event) => {
				event.preventDefault()
				const file = new FormData(event.currentTarget).get('avatar')
				result =
					file instanceof File
						? `${file.name}: ${file.size} bytes`
						: 'No image field'
			}}
		>
			{#if mounted}
				<InputAvatar {...args} bind:value {disabled} required />
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
