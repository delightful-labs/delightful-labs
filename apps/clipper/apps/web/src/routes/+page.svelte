<script lang="ts">
	import AccountDrawer from '../lib/integrations/AccountDrawer.svelte'
	import Library from '../lib/integrations/Library.svelte'
	import { useWorkerLibrary } from '../lib/runtime/worker/context.js'
	let accountDrawer: ReturnType<typeof AccountDrawer> | undefined = $state()
	const accountControl = $derived(accountDrawer?.getControl())
	const runtime = useWorkerLibrary()
</script>

{@render accountControl?.()}
<div class="page-workspace">
	<AccountDrawer bind:this={accountDrawer} />
	<div class="page-content" inert={accountDrawer?.isModal() ?? false}>
		{#if runtime.actor}
			{#key runtime.actor}<Library actor={runtime.actor} />{/key}
		{/if}
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
