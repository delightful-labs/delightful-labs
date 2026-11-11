<script lang="ts">
	import { untrack, type Snippet } from 'svelte'
	import { on } from 'svelte/events'
	import type { HTMLFieldsetAttributes } from 'svelte/elements'

	import { setRadioGroup, type RadioChangeEvent } from './radio-group.js'

	type Props = Omit<
		HTMLFieldsetAttributes,
		'children' | 'name' | 'onchange'
	> & {
		label: string
		children?: Snippet
		name?: string
		value?: string
		defaultValue?: string
		required?: boolean
		onchange?: (event: RadioChangeEvent) => void
	}

	const generatedId = $props.id()
	let {
		label,
		children,
		name,
		value = $bindable(),
		defaultValue,
		required = false,
		disabled = false,
		form,
		onchange,
		class: className,
		...attributes
	}: Props = $props()

	untrack(() => {
		if (value === undefined) value = defaultValue
	})
	const groupName = $derived(name ?? generatedId)
	let fieldset = $state<HTMLFieldSetElement>()

	$effect(() => {
		const owner = form
			? fieldset?.ownerDocument.getElementById(form)
			: fieldset?.form
		if (!(owner instanceof HTMLFormElement)) return
		return on(owner, 'reset', (event) => {
			// Wait until every listener can cancel the native reset.
			queueMicrotask(() => {
				if (!event.defaultPrevented) value = defaultValue
			})
		})
	})

	setRadioGroup({
		get name() {
			return groupName
		},
		get value() {
			return value
		},
		get defaultValue() {
			return defaultValue
		},
		get required() {
			return required
		},
		get disabled() {
			return !!disabled
		},
		get form() {
			return form
		},
		change(event) {
			value = event.currentTarget.value
			onchange?.(event)
		}
	})
</script>

<fieldset
	{...attributes}
	{disabled}
	{form}
	bind:this={fieldset}
	class={['radio-group', className]}
>
	<legend>{label}</legend>
	<div class="options">{@render children?.()}</div>
</fieldset>

<style>
	@property --dui-radio-border-overlap {
		syntax: '*';
		inherits: true;
	}

	.radio-group {
		min-inline-size: 0;
		margin: 0;
		padding: 0;
		border: 0;
		font-family: var(
			--dui-field-font-family,
			var(
				--dui-font-family-interactive,
				'Cascadia Code',
				ui-monospace,
				monospace
			)
		);
		color: var(--dui-field-color, var(--dui-color-foreground, #000));
	}

	legend {
		padding: 0;
		margin-block-end: var(--dui-field-gap, var(--dui-spacing-xs, 0.5rem));
		font-size: var(--dui-field-font-size, var(--dui-font-size-sm, 0.875rem));
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0;
		/* Adjacent options share their border, including after wrapping. */
		padding-inline-end: var(
			--dui-radio-border-overlap,
			var(--dui-border-width, 2px)
		);
		padding-block-end: var(
			--dui-radio-border-overlap,
			var(--dui-border-width, 2px)
		);
	}
</style>
