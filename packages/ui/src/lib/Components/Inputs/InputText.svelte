<script lang="ts">
	import { untrack } from 'svelte'
	import type { HTMLInputAttributes } from 'svelte/elements'
	import InputWrapper from './InputWrapper.svelte'

	type Props = Omit<
		HTMLInputAttributes,
		'type' | 'value' | 'defaultValue' | 'defaultvalue' | 'children'
	> & {
		label: string
		type?: Extract<
			HTMLInputAttributes['type'],
			'text' | 'email' | 'password' | 'search' | 'tel' | 'url'
		>
		value?: string
		defaultValue?: string
	}

	const generatedId = $props.id()
	let {
		label,
		id,
		type = 'text',
		required = false,
		defaultValue,
		value = $bindable(),
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
		{type}
		{required}
		{defaultValue}
		bind:value
	/>
</InputWrapper>
