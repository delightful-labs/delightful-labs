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
		| 'maxlength'
		| 'minlength'
		| 'pattern'
	> & {
		label: string
		value?: number
		defaultValue?: number
		hideArrows?: boolean
	}

	const generatedId = $props.id()
	let {
		label,
		id,
		required = false,
		defaultValue,
		value = $bindable(),
		hideArrows = false,
		class: className,
		...attributes
	}: Props = $props()
	// Seed once so SSR includes the default, without restoring it after edits.
	untrack(() => {
		if (value === undefined) value = defaultValue
	})
	const inputId = $derived(id ?? generatedId)
</script>

<InputWrapper title={label} key={inputId}>
	<input
		{...attributes}
		id={inputId}
		type="number"
		{required}
		{defaultValue}
		class={[className, { 'hide-arrows': hideArrows }]}
		bind:value
	/>
</InputWrapper>

<style>
	.hide-arrows {
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.hide-arrows::-webkit-inner-spin-button,
	.hide-arrows::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
</style>
