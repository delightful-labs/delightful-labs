<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements'
	import type { Snippet } from 'svelte'
	let { children, ...attributes }: Omit<HTMLAnchorAttributes, 'children'> & { children?: Snippet } =
		$props()
</script>

<a {...attributes}>{@render children?.()}</a>
