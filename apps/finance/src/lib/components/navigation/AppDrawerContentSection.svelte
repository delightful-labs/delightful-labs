<script lang="ts">
	import type { Snippet } from 'svelte'
	import { DrawerSection } from 'delightful-ui'

	let {
		element = 'div',
		'aria-labelledby': labelledBy,
		children
	}: {
		element?: 'div' | 'section'
		'aria-labelledby'?: string
		children: Snippet
	} = $props()
</script>

<DrawerSection {element} aria-labelledby={labelledBy}>
	{@render children()}
</DrawerSection>
