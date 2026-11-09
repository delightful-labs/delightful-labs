<script lang="ts">
	import { untrack } from 'svelte'
	import type { HTMLInputAttributes } from 'svelte/elements'
	import InputWrapper from './InputWrapper.svelte'

	type Props = Omit<
		HTMLInputAttributes,
		'type' | 'value' | 'defaultValue' | 'defaultvalue' | 'children'
	> & {
		label: string
		currencyLabel: string
		value?: string
		defaultValue?: string
	}

	const generatedId = $props.id()
	const currencyId = `${generatedId}-currency`
	let {
		label,
		currencyLabel,
		id,
		required = false,
		inputmode = 'decimal',
		autocomplete = 'off',
		defaultValue,
		value = $bindable(),
		'aria-describedby': describedBy,
		...attributes
	}: Props = $props()

	untrack(() => {
		if (value === undefined) value = defaultValue
	})
	const inputId = $derived(id ?? generatedId)
	const descriptionIds = $derived(
		[describedBy, currencyId].filter(Boolean).join(' ')
	)
</script>

<InputWrapper title={label} key={inputId}>
	<div class="entry">
		<input
			{...attributes}
			id={inputId}
			type="text"
			{inputmode}
			{autocomplete}
			{required}
			{defaultValue}
			aria-describedby={descriptionIds}
			bind:value
		/>
		<span id={currencyId} class="currency">{currencyLabel}</span>
	</div>
</InputWrapper>

<style>
	@property --dui-input-currency-gap {
		syntax: '*';
		inherits: true;
	}

	.entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(
			--dui-input-currency-gap,
			var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem))
		);
		min-inline-size: 0;
	}

	input {
		inline-size: 100%;
	}

	.currency {
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
</style>
