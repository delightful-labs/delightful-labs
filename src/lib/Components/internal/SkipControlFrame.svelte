<script lang="ts">
	import type { Snippet } from 'svelte'

	let { children }: { children: Snippet } = $props()
</script>

<span class="skip-control">
	{@render children()}
</span>

<style>
	.skip-control {
		position: fixed;
		inset-block-start: var(--dui-spacing-xs, 0.5rem);
		inset-inline-start: var(--dui-spacing-xs, 0.5rem);
		z-index: 100;
		background-color: var(--dui-color-background, #fff);
	}

	.skip-control:not(:focus-within) {
		inline-size: 1px;
		block-size: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
