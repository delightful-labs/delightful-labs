<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements'
	import FloatingActionFrame from './internal/FloatingActionFrame.svelte'

	let { children, ...attributes }: HTMLAnchorAttributes = $props()
</script>

<FloatingActionFrame>
	<a {...attributes}>{@render children?.()}</a>
</FloatingActionFrame>
