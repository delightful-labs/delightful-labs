<script lang="ts">
	import { tick, type Snippet } from 'svelte'
	import type { ImageInputProps } from './image-input.js'
	import AvatarImageTile from './AvatarImageTile.svelte'
	import AvatarFilePicker from './AvatarFilePicker.svelte'
	import InputWrapper from './InputWrapper.svelte'

	const generatedId = $props.id()
	let {
		label,
		leadingImages,
		imageActions,
		uploadLabel = 'Upload',
		removeLabel = 'Remove',
		closeLabel = 'Close',
		infoLabel = 'File information',
		id,
		shape = 'square',
		imageState,
		value = $bindable([]),
		accept = 'image/*',
		disabled = false,
		...attributes
	}: ImageInputProps & { value?: File[]; leadingImages?: Snippet } = $props()
	const inputId = $derived(id ?? generatedId)
	let input = $state<HTMLInputElement>()

	function remove(file: File) {
		if (disabled || input?.matches(':disabled')) return
		value = value.filter((item) => item !== file)
		void tick().then(() => input?.focus())
	}
</script>

<InputWrapper title={label} key={inputId}>
	<div class="images">
		{#if leadingImages}{@render leadingImages()}{/if}
		{#each value as file (file)}
			<AvatarImageTile
				{file}
				name={file.name}
				state={imageState?.(file)}
				{shape}
				{disabled}
				{removeLabel}
				{closeLabel}
				{infoLabel}
				onremove={() => remove(file)}
			>
				{#snippet actions(close)}
					{#if imageActions}{@render imageActions(file, close)}{/if}
				{/snippet}
			</AvatarImageTile>
		{/each}
		<AvatarFilePicker
			{...attributes}
			bind:input
			id={inputId}
			multiple
			files={value}
			{accept}
			{disabled}
			{shape}
			{uploadLabel}
			onfileschange={(selected) => {
				value = selected.length ? [...new Set([...value, ...selected])] : []
			}}
		/>
	</div>
</InputWrapper>

<style>
	.images {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--dui-avatar-gap, var(--dui-spacing-xs, 0.5rem));
		width: fit-content;
		min-width: min(var(--dui-avatar-size, 8rem), 100%);
		max-width: 100%;
	}
</style>
