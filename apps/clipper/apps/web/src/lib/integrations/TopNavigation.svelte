<script lang="ts">
	import { Navigation } from 'delightful-ui'
	import type { Snippet } from 'svelte'

	type Props = {
		children: Snippet
		label?: string
	}

	let { children, label = 'top navigation' }: Props = $props()
</script>

<Navigation {label} orientation="horizontal">
	{@render children()}
</Navigation>
