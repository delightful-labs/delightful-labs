<script lang="ts">
	import { untrack } from 'svelte'
	import type { HTMLInputAttributes } from 'svelte/elements'
	import InputWrapper from './InputWrapper.svelte'
	import Button from '../Button.svelte'

	type Props = Omit<
		HTMLInputAttributes,
		| 'type'
		| 'value'
		| 'files'
		| 'multiple'
		| 'defaultValue'
		| 'defaultvalue'
		| 'children'
		| 'readonly'
	> & {
		label: string
		removeLabel: string
		value?: File | null
	}

	const generatedId = $props.id()
	let {
		label,
		removeLabel,
		id,
		value = $bindable(null),
		accept = 'image/*',
		disabled = false,
		oninput,
		onchange,
		...attributes
	}: Props = $props()
	const inputId = $derived(id ?? generatedId)
	let input = $state<HTMLInputElement>()
	let preview = $state<string>()
	let failedPreview = $state<string>()

	$effect(() => {
		const file = value
		if (!input) return
		const node = input
		untrack(() => {
			if ((node.files?.[0] ?? null) === file) return
			if (file) {
				const transfer = new DataTransfer()
				transfer.items.add(file)
				node.files = transfer.files
			} else node.value = ''
		})
	})

	$effect(() => {
		const url = value ? URL.createObjectURL(value) : undefined
		preview = url
		return () => {
			if (url) URL.revokeObjectURL(url)
		}
	})

	$effect(() => {
		// Track the explicit form attribute as well as the mounted input.
		attributes.form
		const form = input?.form
		function reset(event: Event) {
			queueMicrotask(() => {
				if (!event.defaultPrevented) value = null
			})
		}
		form?.addEventListener('reset', reset)
		return () => form?.removeEventListener('reset', reset)
	})

	function remove() {
		if (disabled || input?.matches(':disabled')) return
		value = null
		if (input) {
			input.value = ''
			input.focus()
		}
	}
</script>

<InputWrapper title={label} key={inputId}>
	<input
		{...attributes}
		bind:this={input}
		id={inputId}
		type="file"
		class:selected={value !== null}
		{accept}
		{disabled}
		oninput={(event) => {
			value = event.currentTarget.files?.[0] ?? null
			oninput?.(event)
		}}
		onchange={(event) => {
			value = event.currentTarget.files?.[0] ?? null
			onchange?.(event)
		}}
	/>
	{#if value}
		<span class="filename" aria-hidden="true">{value.name}</span>
		{#if preview && failedPreview !== preview}
			<img
				src={preview}
				alt=""
				onerror={(event) => {
					failedPreview = event.currentTarget.getAttribute('src') ?? undefined
				}}
			/>
		{/if}
		<div class="remove">
			<Button appearance="flat" {disabled} onclick={remove}
				>{removeLabel}</Button
			>
		</div>
	{/if}
</InputWrapper>

<style>
	input {
		width: 100%;
		--dui-input-padding: 0;
		--dui-input-border-width: 0;
		--dui-input-background-color: transparent;
	}

	input::file-selector-button {
		appearance: none;
		box-sizing: border-box;
		font-family: var(
			--dui-button-font-family,
			var(
				--dui-font-family-interactive,
				'Cascadia Code',
				ui-monospace,
				monospace
			)
		);
		font-size: var(
			--dui-button-font-size,
			var(--dui-input-font-size, var(--dui-font-size-md, 1rem))
		);
		line-height: 1.25;
		padding: var(
			--dui-button-padding,
			var(--dui-spacing-xs, 0.5rem) var(--dui-spacing-md, 1rem)
		);
		min-height: var(--dui-button-min-height, 44px);
		max-width: 100%;
		white-space: normal;
		overflow-wrap: anywhere;
		margin-inline-end: var(--dui-field-gap, var(--dui-spacing-xxs, 0.25rem));
		color: var(--dui-button-color, var(--dui-color-foreground, #000));
		background: var(
			--dui-button-background-color,
			var(--dui-color-background, #fff)
		);
		border: var(--dui-button-border-width, var(--dui-border-width, 2px))
			var(--dui-button-border-style, solid)
			var(--dui-button-border-color, var(--dui-color-foreground, #000));
		border-radius: 0;
		box-shadow: var(--dui-button-box-shadow, none);
		cursor: pointer;
	}

	input:not(:disabled)::file-selector-button:hover {
		color: var(--dui-button-color-hover, var(--dui-color-background, #fff));
		background: var(
			--dui-button-background-color-hover,
			var(--dui-color-foreground, #000)
		);
		border-color: var(
			--dui-button-border-color-hover,
			var(--dui-color-foreground, #000)
		);
	}

	input[type='file']:focus-visible {
		outline: none;
	}

	input:focus-visible::file-selector-button {
		outline: 2px dashed
			var(--dui-button-focus-color, var(--dui-color-focus, #2563eb));
		outline-offset: -4px;
	}

	input:is(
			[data-valid='false'],
			[aria-invalid='true'],
			:user-invalid
		)::file-selector-button {
		border-color: var(--dui-input-error-color, var(--dui-color-error, #b91c1c));
	}

	input:disabled::file-selector-button {
		cursor: not-allowed;
	}

	@media (forced-colors: active) {
		input:focus-visible::file-selector-button {
			outline-color: Highlight;
		}
	}

	/* Native filename text cannot wrap; render it separately when selected. */
	input.selected {
		font-size: 0;
	}

	.filename {
		min-width: 0;
		white-space: normal;
		overflow-wrap: anywhere;
		font-family: var(
			--dui-input-font-family,
			var(
				--dui-font-family-interactive,
				'Cascadia Code',
				ui-monospace,
				monospace
			)
		);
		font-size: var(--dui-input-font-size, inherit);
		color: var(--dui-input-color, var(--dui-color-foreground, inherit));
	}

	.remove :global(button) {
		max-width: 100%;
		white-space: normal;
		overflow-wrap: anywhere;
	}

	img {
		display: block;
		max-width: 100%;
		width: auto;
		height: auto;
		max-height: 16rem;
		object-fit: contain;
		align-self: start;
	}

	.remove {
		min-width: 0;
	}
</style>
