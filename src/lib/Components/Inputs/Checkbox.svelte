<script lang="ts">
	import { untrack } from 'svelte'
	import type { HTMLInputAttributes } from 'svelte/elements'

	type Props = Omit<
		HTMLInputAttributes,
		| 'type'
		| 'checked'
		| 'defaultChecked'
		| 'defaultchecked'
		| 'value'
		| 'defaultValue'
		| 'defaultvalue'
		| 'children'
		| 'indeterminate'
		| 'bind:checked'
		| 'bind:indeterminate'
		| 'readonly'
	> & {
		label: string
		checked?: boolean
		defaultChecked?: boolean
		value?: string
	}

	const generatedId = $props.id()
	let {
		label,
		id,
		required = false,
		defaultChecked,
		checked = $bindable(),
		...attributes
	}: Props = $props()

	// Seed once for SSR, without restoring the default after edits.
	untrack(() => {
		if (checked === undefined) checked = defaultChecked ?? false
	})
	const checkboxId = $derived(id ?? generatedId)
</script>

<label class="checkbox-field" for={checkboxId}>
	<input
		{...attributes}
		id={checkboxId}
		type="checkbox"
		{required}
		{defaultChecked}
		bind:checked
	/>
	<span>{label}</span>
</label>

<style>
	@property --dui-checkbox-accent-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-checkbox-disabled-opacity {
		syntax: '<number> | <percentage>';
		inherits: true;
		initial-value: 0.5;
	}

	@property --dui-checkbox-error-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-checkbox-focus-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-checkbox-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-checkbox-min-height {
		syntax: '<length-percentage>';
		inherits: true;
		initial-value: 44px;
	}

	@property --dui-checkbox-size {
		syntax: '*';
		inherits: true;
	}

	.checkbox-field {
		display: flex;
		align-items: center;
		gap: var(
			--dui-checkbox-gap,
			var(--dui-field-gap, var(--dui-spacing-xs, 0.5rem))
		);
		min-block-size: var(--dui-checkbox-min-height, 44px);
		font-family: var(
			--dui-field-font-family,
			var(
				--dui-font-family-interactive,
				'Cascadia Code',
				ui-monospace,
				monospace
			)
		);
		font-size: var(--dui-field-font-size, var(--dui-font-size-sm, 0.875rem));
		color: var(--dui-field-color, var(--dui-color-foreground, inherit));
	}

	input {
		flex: none;
		inline-size: var(--dui-checkbox-size, 1.25rem);
		block-size: var(--dui-checkbox-size, 1.25rem);
		margin: 0;
		accent-color: var(
			--dui-checkbox-accent-color,
			var(--dui-color-accent, #94ff47)
		);
	}

	span {
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	input[aria-invalid='true'],
	input:user-invalid {
		outline: 2px solid
			var(--dui-checkbox-error-color, var(--dui-color-error, #b91c1c));
		outline-offset: 2px;
	}

	input:focus-visible {
		outline: 2px solid
			var(--dui-checkbox-focus-color, var(--dui-color-focus, currentColor));
		outline-offset: 4px;
	}

	input:disabled,
	input:disabled + span {
		opacity: var(--dui-checkbox-disabled-opacity, 0.5);
		cursor: not-allowed;
	}

	@media (forced-colors: active) {
		input:focus-visible,
		input[aria-invalid='true'],
		input:user-invalid {
			outline-color: Highlight;
		}
	}
</style>
