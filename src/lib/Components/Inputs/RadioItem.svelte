<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLInputAttributes } from 'svelte/elements'
	import { getRadioGroup } from './radio-group.js'

	type Props = Omit<
		HTMLInputAttributes,
		| 'type'
		| 'name'
		| 'form'
		| 'value'
		| 'defaultValue'
		| 'defaultvalue'
		| 'checked'
		| 'defaultChecked'
		| 'defaultchecked'
		| 'bind:checked'
		| 'bind:group'
		| 'indeterminate'
		| 'bind:indeterminate'
		| 'readonly'
		| 'children'
	> & {
		value: string
		children: Snippet
	}

	let {
		value,
		children,
		disabled = false,
		required = false,
		onchange,
		class: className,
		style,
		...attributes
	}: Props = $props()
	const group = getRadioGroup()
</script>

<label class={['option', className]} {style}>
	<input
		{...attributes}
		type="radio"
		name={group.name}
		{value}
		form={group.form}
		required={group.required || required}
		disabled={group.disabled || disabled}
		defaultChecked={group.defaultValue !== undefined &&
			group.defaultValue === value}
		checked={group.value === value}
		onchange={(event) => {
			group.change(event)
			onchange?.(event)
		}}
	/>
	<span>{@render children()}</span>
</label>

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

	.option {
		position: relative;
		display: flex;
		min-inline-size: 0;
		max-inline-size: 100%;
		font-family: var(--dui-field-font-family, var(--dui-font-family, inherit));
		margin-inline-end: calc(
			-1 * var(--dui-radio-border-overlap, var(--dui-border-width, 2px))
		);
		margin-block-end: calc(
			-1 * var(--dui-radio-border-overlap, var(--dui-border-width, 2px))
		);
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
		display: block;
		flex: 1;
		align-content: center;
		text-align: center;
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
