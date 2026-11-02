<script lang="ts">
	import { Select } from 'delightful-ui'
	import type { HTMLSelectAttributes } from 'svelte/elements'
	import type {
		WorkspaceSelectorMessages,
		WorkspaceSelectorView
	} from '../../contracts/workspace-selector.js'

	type Props = Omit<
		HTMLSelectAttributes,
		'children' | 'multiple' | 'value' | 'defaultValue' | 'defaultvalue' | 'disabled' | 'onchange'
	> & {
		view: WorkspaceSelectorView
		messages: WorkspaceSelectorMessages
		onSelect: (workspaceId: string) => void
	}
	let { view, messages, onSelect, ...attributes }: Props = $props()
	const instanceId = $props.id()
	const emptyId = `${instanceId}-empty`
	const describedBy = $derived(
		[attributes['aria-describedby'], view.kind === 'empty' ? emptyId : undefined]
			.filter(Boolean)
			.join(' ') || undefined
	)
	// The applied value is read-only; native requests are forwarded separately below.
	function choose(event: Event & { currentTarget: HTMLSelectElement }) {
		const id = event.currentTarget.value
		// DUI's native binding must retain the host's applied selection, not the request.
		event.currentTarget.value = view.kind === 'choices' ? view.selectedId : ''
		if (view.kind === 'choices' && view.canChoose && view.entries.some((entry) => entry.id === id))
			onSelect(id)
	}
</script>

<Select
	{...attributes}
	label={messages.label}
	bind:value={
		() => (view.kind === 'choices' ? view.selectedId : ''),
		() => {}
	}
	disabled={view.kind !== 'choices' || !view.canChoose}
	aria-describedby={describedBy}
	onchange={choose}
>
	<option value="" disabled>{messages.placeholder}</option>
	{#if view.kind === 'choices'}
		{#each view.entries as entry (entry.id)}
			<option value={entry.id}>{entry.label}</option>
		{/each}
	{/if}
</Select>
{#if view.kind === 'empty'}<p id={emptyId}>{messages.empty}</p>{/if}
