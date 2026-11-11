<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import InputImages from '#lib/Components/Inputs/InputImages.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Images',
		component: InputImages,
		args: { label: 'Images', name: 'images', removeLabel: 'Remove image' }
	})
</script>

<script lang="ts">
	import { onMount } from 'svelte'
	let exampleFiles = $state<File[]>([])
	onMount(() => {
		const image =
			'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#6a8a78"/><circle cx="64" cy="48" r="24" fill="#eee"/><ellipse cx="64" cy="115" rx="46" ry="38" fill="#eee"/></svg>'
		exampleFiles = [
			new File([image], 'Portrait.svg', { type: 'image/svg+xml' }),
			new File([image], 'Uploading.svg', { type: 'image/svg+xml' }),
			new File([image], 'Failed.svg', { type: 'image/svg+xml' })
		]
	})

	let value = $state<File[]>([])
	let disabled = $state(false)
	let mounted = $state(true)
	let preventReset = $state(false)
	let result = $state('No submission yet.')
</script>

<Story name="Default" />
<Story name="Circle" args={{ shape: 'circle' }} />
<Story name="Image list states">
	{#snippet template(args)}
		<InputImages
			{...args}
			shape="circle"
			bind:value={exampleFiles}
			imageState={(file) =>
				file.name === 'Uploading.svg'
					? { status: 'uploading', label: 'Uploading…' }
					: file.name === 'Failed.svg'
						? { status: 'error', label: 'Upload failed' }
						: { status: 'ready' }}
		/>
	{/snippet}
</Story>

<Story name="Bound form">
	{#snippet template(args)}
		<form
			onreset={(event) => {
				if (preventReset) event.preventDefault()
			}}
			onsubmit={(event) => {
				event.preventDefault()
				result =
					new FormData(event.currentTarget)
						.getAll('images')
						.map((file) =>
							file instanceof File ? `${file.name}: ${file.size} bytes` : ''
						)
						.join(', ') || 'No image field'
			}}
		>
			{#if mounted}<InputImages {...args} bind:value {disabled} required />{/if}
			<p role="status">
				{value.map((file) => file.name).join(', ') || 'No images'}
			</p>
			<button type="submit">Submit</button>
			<button type="reset">Reset</button>
			<button
				type="button"
				onclick={() =>
					(value = [
						new File(['invalid image'], 'parent.png', { type: 'image/png' })
					])}>Set images</button
			>
			<button type="button" onclick={() => (disabled = !disabled)}
				>Toggle disabled</button
			>
			<button type="button" onclick={() => (mounted = !mounted)}
				>Toggle component</button
			>
			<pre aria-live="polite">{result}</pre>
		</form>
		<label
			><input type="checkbox" bind:checked={preventReset} />Prevent reset</label
		>
	{/snippet}
</Story>
