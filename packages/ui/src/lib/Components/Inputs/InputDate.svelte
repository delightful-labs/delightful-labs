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
		| 'bind:value'
		| 'min'
		| 'max'
		| 'pattern'
		| 'minlength'
		| 'maxlength'
		| 'size'
	> & {
		label: string
		value?: string
		defaultValue?: string
		min?: string
		max?: string
	}

	const generatedId = $props.id()
	let {
		label,
		id,
		required = false,
		defaultValue,
		value = $bindable(),
		...attributes
	}: Props = $props()

	// Seed once for SSR, without restoring the default after edits.
	untrack(() => {
		if (value === undefined) value = defaultValue
	})
	const inputId = $derived(id ?? generatedId)
</script>

<InputWrapper title={label} key={inputId}>
	<input
		{...attributes}
		id={inputId}
		type="date"
		{required}
		{defaultValue}
		bind:value
	/>
</InputWrapper>
