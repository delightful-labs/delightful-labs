<script lang="ts">
	import type { Snippet } from 'svelte'
	import AccountDrawer from './AccountDrawer.svelte'
	let {
		focused = false,
		showControl = true,
		children
	}: {
		focused?: boolean
		showControl?: boolean
		children: Snippet<[Snippet | undefined]>
	} = $props()
	let drawer: ReturnType<typeof AccountDrawer> | undefined = $state()
	const control = $derived(drawer?.getControl())
</script>

{#if showControl}{@render control?.()}{/if}
<div class="page-workspace">
	<AccountDrawer bind:this={drawer} {focused} />
	<div class="page-content" inert={drawer?.isModal() ?? false}>
		{@render children(control)}
	</div>
</div>

<style>
	.page-workspace {
		position: relative;
		display: flex;
		min-inline-size: 0;
	}
	.page-content {
		flex: 1 1 0%;
		min-inline-size: 0;
	}
	@media (max-width: 48rem) {
		.page-workspace {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
		}
		.page-content {
			grid-area: 1 / 1;
		}
	}
</style>
