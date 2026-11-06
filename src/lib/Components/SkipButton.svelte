<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements'
	import SkipControlFrame from './internal/SkipControlFrame.svelte'

	let {
		children,
		type = 'button',
		...attributes
	}: HTMLButtonAttributes = $props()
</script>

<SkipControlFrame>
	<button {...attributes} {type}>{@render children?.()}</button>
</SkipControlFrame>
