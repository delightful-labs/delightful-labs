<script lang="ts">
	import { untrack } from 'svelte'
	import type { HTMLTextareaAttributes } from 'svelte/elements'
	import InputWrapper from './InputWrapper.svelte'

	type Props = Omit<
		HTMLTextareaAttributes,
		'value' | 'defaultValue' | 'defaultvalue' | 'children' | 'bind:value'
	> & {
		label: string
		value?: string
		defaultValue?: string
	}

	const generatedId = $props.id()
	let {
		label,
		id,
		required = false,
		rows = 4,
		defaultValue,
		value = $bindable(),
		...attributes
	}: Props = $props()

	// Seed once for SSR, without restoring the default after edits.
	untrack(() => {
		if (value === undefined) value = defaultValue
	})
	const textareaId = $derived(id ?? generatedId)
</script>

<InputWrapper title={label} key={textareaId}>
	<textarea
		{...attributes}
		id={textareaId}
		{required}
		{rows}
		{defaultValue}
		bind:value></textarea>
</InputWrapper>

<style>
	@property --dui-textarea-resize {
		syntax: 'none | both | horizontal | vertical | block | inline';
		inherits: true;
		initial-value: vertical;
	}

	textarea {
		max-inline-size: 100%;
		resize: var(--dui-textarea-resize, vertical);
	}
</style>
