<script lang="ts">
	import type { Snippet } from 'svelte'

	let { children, trailing }: { children: Snippet; trailing: Snippet } = $props()
</script>

<div class="split-row">
	{@render children()}
	{@render trailing()}
</div>

<style>
	.split-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--dui-spacing-md);
		flex-wrap: wrap;
		min-inline-size: 0;
	}
</style>
