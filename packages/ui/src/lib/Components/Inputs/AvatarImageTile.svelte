<script lang="ts">
	import type { Snippet } from 'svelte'
	import Button from '../Button.svelte'
	import Dialog from '../Dialog.svelte'
	import ImageIcon from 'tdesign-icons-svg/src/image.svg?component'
	import LoadingSpinner from '../LoadingSpinner.svelte'
	import AvatarTile from './AvatarTile.svelte'

	let {
		name,
		file,
		actions,
		picker,
		preview,
		downloadUrl,
		alt = name,
		removeAccessibleLabel,
		previewFailed = false,
		state: imageState,
		shape = 'square',
		disabled = false,
		removeLabel,
		infoLabel = 'Image preview',
		closeLabel = 'Close',
		onremove,
		onpreviewerror
	}: {
		picker?: Snippet<[() => void]>
		actions?: Snippet<[() => void]>
		file?: File
		name: string
		downloadUrl?: string
		alt?: string
		removeAccessibleLabel?: string
		preview?: string
		previewFailed?: boolean
		state?: { status: 'ready' | 'uploading' | 'error'; label?: string }
		shape?: 'square' | 'circle'
		disabled?: boolean | null
		infoLabel?: string
		closeLabel?: string
		removeLabel: string
		onremove?: (() => void) | undefined
		onpreviewerror?: (url: string) => void
	} = $props()
	let open = $state(false)
	let localPreview = $state<string>()
	let failedLocalPreview = $state<string>()
	const imageUrl = $derived(localPreview ?? preview)
	const imageFailed = $derived(
		previewFailed || (imageUrl !== undefined && failedLocalPreview === imageUrl)
	)
	function close() {
		open = false
	}
	$effect(() => {
		const url = file ? URL.createObjectURL(file) : undefined
		localPreview = url
		return () => {
			if (url) URL.revokeObjectURL(url)
		}
	})
</script>

{#snippet image(large = false)}
	{#key imageUrl}
		<img
			class:large
			src={imageUrl}
			{alt}
			onerror={(event) => {
				if (event.currentTarget instanceof HTMLImageElement) {
					failedLocalPreview = event.currentTarget.src
					onpreviewerror?.(event.currentTarget.src)
				}
			}}
		/>
	{/key}
{/snippet}

<div class="item">
	<AvatarTile {shape} status={imageFailed ? 'error' : imageState?.status}>
		{#if imageState?.status === 'uploading'}
			<LoadingSpinner text={imageState.label ?? name} />
		{:else if imageState?.status === 'error' || imageFailed}
			<ImageIcon width="24" height="24" aria-hidden="true" />
			<span role="alert">{imageState?.label ?? name}</span>
		{:else if imageUrl}
			{@render image()}
		{/if}
		<button
			class="trigger"
			type="button"
			aria-label={`${infoLabel}: ${name}`}
			aria-haspopup="dialog"
			onclick={() => (open = true)}
		></button>
	</AvatarTile>
	<Dialog heading={name} bind:open closedby="any">
		{#if open && imageUrl && !imageFailed && imageState?.status !== 'error' && imageState?.status !== 'uploading'}
			{@render image(true)}
		{:else if imageFailed || imageState?.status === 'error'}
			<p role="alert">{imageState?.label ?? name}</p>
		{:else if imageState?.status === 'uploading'}
			<LoadingSpinner text={imageState.label ?? name} />
		{/if}
		{#if downloadUrl}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Native download URLs belong to the consumer. -->
			<a class="filename" href={downloadUrl} download={name}>{name}</a>
		{/if}
		<div class="actions">
			{#if actions}{@render actions(close)}{/if}
			{#if onremove}
				<Button
					type="button"
					{disabled}
					aria-label={removeAccessibleLabel ?? `${removeLabel}: ${name}`}
					onclick={() => {
						close()
						onremove?.()
					}}>{removeLabel}</Button
				>
			{/if}
			<Button type="button" onclick={close}>{closeLabel}</Button>
		</div>
		{#if picker}{@render picker(close)}{/if}
	</Dialog>
</div>

<style>
	.item {
		width: var(--dui-avatar-size, 8rem);
		max-width: 100%;
	}
	.trigger {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: 0;
		border-radius: inherit;
		background: transparent;
		cursor: pointer;
	}
	.trigger:focus-visible {
		outline: 2px solid var(--dui-color-focus, currentColor);
		outline-offset: -4px;
	}
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	img.large {
		position: static;
		display: block;
		width: 100%;
		height: auto;
		max-height: 60dvh;
		object-fit: contain;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-spacing-xs, 0.5rem);
		margin-block-start: var(--dui-spacing-md, 1rem);
	}
	.filename {
		overflow-wrap: anywhere;
	}
	span {
		max-width: 80%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
