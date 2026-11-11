<script lang="ts">
	import { untrack } from 'svelte'
	import type { HTMLInputAttributes } from 'svelte/elements'
	import InputWrapper from './InputWrapper.svelte'

	type Props = Omit<
		HTMLInputAttributes,
		| 'type'
		| 'value'
		| 'defaultValue'
		| 'defaultvalue'
		| 'children'
		| 'readonly'
		| 'required'
		| 'maxlength'
		| 'minlength'
		| 'pattern'
	> & {
		label: string
		value?: number
		defaultValue?: number
	}

	const generatedId = $props.id()
	let {
		label,
		id,
		defaultValue,
		value = $bindable(),
		class: className,
		...attributes
	}: Props = $props()
	untrack(() => {
		if (value === undefined) value = defaultValue
	})
	const inputId = $derived(id ?? generatedId)
</script>

<InputWrapper title={label} key={inputId}>
	<input
		{...attributes}
		id={inputId}
		type="range"
		{defaultValue}
		class={className}
		bind:value
	/>
</InputWrapper>

<style>
	@property --dui-input-accent-color {
		syntax: '*';
		inherits: true;
	}

	input {
		inline-size: 100%;
		padding: 0;
		border: 0;
		accent-color: var(
			--dui-input-accent-color,
			var(--dui-color-accent, currentColor)
		);
	}
</style>
