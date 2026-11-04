<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements'
	import FloatingActionFrame from './internal/FloatingActionFrame.svelte'

	let {
		children,
		type = 'button',
		...attributes
	}: HTMLButtonAttributes = $props()
</script>

<FloatingActionFrame>
	<button {...attributes} {type}>{@render children?.()}</button>
</FloatingActionFrame>
