<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements'
	import SkipControlFrame from './internal/SkipControlFrame.svelte'

	let { children, ...attributes }: HTMLAnchorAttributes & { href: string } =
		$props()
</script>

<SkipControlFrame>
	<a {...attributes}>{@render children?.()}</a>
</SkipControlFrame>
