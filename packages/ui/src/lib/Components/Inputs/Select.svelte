<script lang="ts">
	import { untrack } from 'svelte'
	import type { HTMLSelectAttributes } from 'svelte/elements'
	import InputWrapper from './InputWrapper.svelte'

	type Props = Omit<
		HTMLSelectAttributes,
		'multiple' | 'value' | 'defaultValue' | 'defaultvalue' | 'bind:value'
	> & {
		label: string
	} & (
			| { multiple?: false; value?: string; defaultValue?: string }
			| { multiple: true; value?: string[]; defaultValue?: string[] }
		)

	const generatedId = $props.id()
	let {
		label,
		id,
		required = false,
		multiple = false,
		defaultValue,
		value = $bindable(),
		children,
		...attributes
	}: Props = $props()

	untrack(() => {
		if (value === undefined) value = defaultValue
	})
	const selectId = $derived(id ?? generatedId)
</script>

<InputWrapper title={label} key={selectId}>
	{#if multiple}
		<select
			{...attributes}
			id={selectId}
			{required}
			multiple
			{defaultValue}
			bind:value
		>
			{@render children?.()}
		</select>
	{:else}
		<div class="dropdown" class:listbox={(attributes.size ?? 0) > 1}>
			<select
				{...attributes}
				id={selectId}
				{required}
				{defaultValue}
				bind:value
			>
				{@render children?.()}
			</select>
		</div>
	{/if}
</InputWrapper>

<style>
	.dropdown {
		position: relative;
		min-width: 0;
	}

	.dropdown select {
		width: 100%;
	}

	.dropdown:has(select[size]) {
		align-self: start;
		max-width: 100%;
	}

	.dropdown select[size] {
		width: auto;
		max-width: 100%;
	}

	/* Native iOS dropdowns do not honor the shared input line-height. */
	.dropdown:not(.listbox) select {
		-webkit-appearance: none;
		appearance: none;
		padding-inline-end: calc(var(--dui-spacing-md, 1rem) + 1.5rem);
	}

	.dropdown:not(.listbox)::after {
		content: '';
		position: absolute;
		inset-inline-end: var(--dui-spacing-md, 1rem);
		top: 50%;
		width: 0.5rem;
		height: 0.5rem;
		border-inline-end: 2px solid;
		border-bottom: 2px solid;
		color: var(--dui-input-color, var(--dui-color-foreground, inherit));
		transform: translateY(-75%) rotate(45deg);
		pointer-events: none;
	}

	.dropdown:has(select:disabled)::after {
		opacity: var(--dui-input-disabled-opacity, 0.5);
	}
</style>
