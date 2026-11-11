<script lang="ts">
	import { untrack } from 'svelte'
	import type { HTMLInputAttributes } from 'svelte/elements'
	import Icon from '../Icon.svelte'
	import AvatarTile from './AvatarTile.svelte'
	let {
		input = $bindable(),
		files,
		onfileschange,
		oninput,
		onchange,
		shape = 'square',
		embedded = false,
		uploadLabel,
		...attributes
	}: Omit<HTMLInputAttributes, 'type' | 'value' | 'files' | 'children'> & {
		files: readonly File[]
		onfileschange: (files: File[]) => void
		embedded?: boolean
		input?: HTMLInputElement
		shape?: 'square' | 'circle'
		uploadLabel: string
	} = $props()

	$effect(() => {
		const selected = files
		const node = input
		if (!node) return
		untrack(() => {
			if (
				node.files?.length === selected.length &&
				selected.every((file, index) => node.files?.[index] === file)
			)
				return
			const transfer = new DataTransfer()
			selected.forEach((file) => transfer.items.add(file))
			node.files = transfer.files
		})
	})
	$effect(() => {
		attributes.form
		const form = input?.form
		function reset(event: Event) {
			queueMicrotask(() => {
				if (!event.defaultPrevented) onfileschange([])
			})
		}
		form?.addEventListener('reset', reset)
		return () => form?.removeEventListener('reset', reset)
	})
</script>

{#snippet fileInput()}
	<input
		{...attributes}
		bind:this={input}
		type="file"
		oninput={(event) => {
			const selected = Array.from(event.currentTarget.files ?? [])
			if (selected.length > 0) onfileschange(selected)
			oninput?.(event)
		}}
		onchange={(event) => onchange?.(event)}
	/>
{/snippet}

{#if embedded}
	{@render fileInput()}
{:else}
	<AvatarTile {shape} picker>
		{@render fileInput()}
		<Icon width="24" height="24"><path d="M12 5v14M5 12h14" /></Icon>
		<span>{uploadLabel}</span>
	</AvatarTile>
{/if}

<style>
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		z-index: 1;
		cursor: pointer;
	}
	input:disabled {
		cursor: not-allowed;
	}
	span {
		max-width: 80%;
		white-space: normal;
		overflow-wrap: anywhere;
		text-align: center;
	}
</style>
