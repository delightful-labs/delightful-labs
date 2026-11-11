<script lang="ts">
	import type { Snippet } from 'svelte'

	let {
		navigation,
		pageHeading,
		children
	}: {
		navigation: Snippet
		pageHeading: Snippet
		children?: Snippet
	} = $props()
</script>

<div class="page-layout">
	<div class="page-navigation">{@render navigation()}</div>
	<div class="page-heading">{@render pageHeading()}</div>
	<div class="page-body">{@render children?.()}</div>
</div>

<style>
	.page-layout {
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		grid-template-rows: auto auto;
		align-content: start;
		align-items: start;
		min-inline-size: 0;
		min-block-size: 0;
		block-size: 100%;
		overflow: auto;
		overscroll-behavior: contain;
		row-gap: var(--dui-spacing-md);
	}

	.page-navigation {
		grid-column: 1;
		grid-row: 1;
		align-self: start;
	}

	.page-heading {
		grid-column: 2;
		grid-row: 1;
		align-self: center;
		min-inline-size: 0;
	}

	.page-body {
		align-self: stretch;
		grid-column: 1 / -1;
		grid-row: 2;
		min-inline-size: 0;
		min-block-size: 0;
	}
</style>
