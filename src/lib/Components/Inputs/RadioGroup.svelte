<script lang="ts">
	import { untrack } from 'svelte'
	import { on } from 'svelte/events'
	import type { HTMLFieldsetAttributes } from 'svelte/elements'

	export type RadioOption = {
		label: string
		value: string
		disabled?: boolean
	}

	type Props = Omit<
		HTMLFieldsetAttributes,
		'children' | 'name' | 'onchange'
	> & {
		label: string
		options: RadioOption[]
		name?: string
		value?: string
		defaultValue?: string
		required?: boolean
		onchange?: (event: Event & { currentTarget: HTMLInputElement }) => void
	}

	const generatedId = $props.id()
	let {
		label,
		options,
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
</script>

<fieldset
	{...attributes}
	{disabled}
	{form}
	bind:this={fieldset}
	class={['radio-group', className]}
>
	<legend>{label}</legend>
	<div class="options">
		{#each options as option (option.value)}
			<label class="option">
				<input
					type="radio"
					name={groupName}
					value={option.value}
					{required}
					{form}
					disabled={disabled || option.disabled}
					defaultChecked={defaultValue !== undefined &&
						defaultValue === option.value}
					checked={value === option.value}
					onchange={(event) => {
						value = event.currentTarget.value
						onchange?.(event)
					}}
				/>
				<span>{option.label}</span>
			</label>
		{/each}
	</div>
</fieldset>

<style>
	@property --dui-radio-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-radio-border-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-radio-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-radio-selected-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-radio-selected-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-radio-focus-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-radio-min-height {
		syntax: '<length-percentage>';
		inherits: true;
		initial-value: 44px;
	}

	@property --dui-radio-padding {
		syntax: '*';
		inherits: true;
	}

	@property --dui-radio-disabled-opacity {
		syntax: '<number> | <percentage>';
		inherits: true;
		initial-value: 0.5;
	}

	.radio-group {
		min-inline-size: 0;
		margin: 0;
		padding: 0;
		border: 0;
		font-family: var(--dui-field-font-family, var(--dui-font-family, inherit));
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
		padding-inline-end: var(--dui-border-width, 2px);
		padding-block-end: var(--dui-border-width, 2px);
	}

	.option {
		position: relative;
		display: flex;
		min-inline-size: 0;
		max-inline-size: 100%;
		margin-inline-end: calc(-1 * var(--dui-border-width, 2px));
		margin-block-end: calc(-1 * var(--dui-border-width, 2px));
	}

	input {
		position: absolute;
		inset: 0;
		inline-size: 100%;
		block-size: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	span {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-block-size: var(--dui-radio-min-height, 44px);
		min-inline-size: 0;
		padding: var(
			--dui-radio-padding,
			var(--dui-spacing-xs, 0.5rem) var(--dui-spacing-md, 1rem)
		);
		border: var(--dui-border-width, 2px) solid
			var(--dui-radio-border-color, var(--dui-color-foreground, #000));
		border-radius: 0;
		font-size: var(--dui-input-font-size, inherit);
		line-height: 1.25;
		overflow-wrap: anywhere;
		color: var(--dui-radio-color, var(--dui-color-foreground, #000));
		background: var(
			--dui-radio-background-color,
			var(--dui-color-background, #fff)
		);
		pointer-events: none;
	}

	input:hover:not(:disabled) + span {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	input:checked + span {
		color: var(--dui-radio-selected-color, #000);
		background: var(
			--dui-radio-selected-background-color,
			var(--dui-color-accent, #94ff47)
		);
		/* Keep the selected state distinguishable without color. */
		box-shadow: inset 0 -3px 0 currentColor;
	}

	.option:has(input:focus-visible) {
		z-index: 1;
	}

	input:focus-visible + span {
		outline: 2px dashed
			var(--dui-radio-focus-color, var(--dui-color-focus, #2563eb));
		outline-offset: 3px;
	}

	input:disabled {
		cursor: not-allowed;
	}

	input:disabled + span {
		opacity: var(--dui-radio-disabled-opacity, 0.5);
	}

	@media (forced-colors: active) {
		input:checked + span {
			color: HighlightText;
			background: Highlight;
			forced-color-adjust: none;
		}

		input:disabled + span {
			color: GrayText;
		}

		input:focus-visible + span {
			outline-color: Highlight;
		}
	}
</style>
