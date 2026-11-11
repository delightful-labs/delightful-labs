<script lang="ts">
	import { tick } from 'svelte'
	import type { ImageInputProps } from './image-input.js'
	import AvatarImageTile from './AvatarImageTile.svelte'
	import AvatarFilePicker from './AvatarFilePicker.svelte'
	import InputWrapper from './InputWrapper.svelte'

	const generatedId = $props.id()
	let {
		label,
		imageActions,
		uploadLabel = 'Upload',
		removeLabel = 'Remove',
		closeLabel = 'Close',
		infoLabel = 'File information',
		id,
		shape = 'square',
		imageState,
		value = $bindable(null),
		accept = 'image/*',
		disabled = false,
		...attributes
	}: ImageInputProps & { value?: File | null } = $props()
	const inputId = $derived(id ?? generatedId)
	const files = $derived(value ? [value] : [])
	let input = $state<HTMLInputElement>()

	function remove() {
		if (disabled || input?.matches(':disabled')) return
		value = null
		void tick().then(() => input?.focus())
	}
</script>

{#snippet filePicker(embedded = false, closePreview = () => {})}
	<AvatarFilePicker
		{...attributes}
		{embedded}
		bind:input
		id={inputId}
		{files}
		{accept}
		{disabled}
		{shape}
		{uploadLabel}
		onfileschange={(selected) => {
			closePreview()
			value = selected[0] ?? null
		}}
	/>
{/snippet}

<InputWrapper title={label} key={inputId}>
	{#if value}
		<AvatarImageTile
			file={value}
			name={value.name}
			state={imageState?.(value)}
			{shape}
			{disabled}
			{removeLabel}
			{closeLabel}
			removeAccessibleLabel={removeLabel}
			{infoLabel}
			onremove={remove}
		>
			{#snippet picker(closePreview)}
				<div class="replacement">
					{uploadLabel}
					{@render filePicker(true, closePreview)}
				</div>
			{/snippet}
			{#snippet actions(close)}
				{#if imageActions && value}{@render imageActions(value, close)}{/if}
			{/snippet}
		</AvatarImageTile>
	{:else}
		{@render filePicker()}
	{/if}
</InputWrapper>

<style>
	.replacement {
		position: relative;
		width: fit-content;
		padding: var(--dui-spacing-xs, 0.5rem);
		margin-block-start: var(--dui-spacing-xs, 0.5rem);
		border: var(--dui-border-width, 2px) solid currentColor;
	}
	.replacement:focus-within {
		outline: 2px solid var(--dui-color-focus, currentColor);
		outline-offset: 2px;
	}
</style>
