<script lang="ts">
	let { enabled }: { enabled: boolean } = $props()
</script>

{#if enabled}
	<div class="demo-border" aria-hidden="true"></div>
{/if}

<style>
	.demo-border {
		position: fixed;
		inset: 0;
		z-index: 2147483647;
		border: 3px solid red;
		pointer-events: none;
	}
</style>
