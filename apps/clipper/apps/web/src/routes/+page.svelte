<script lang="ts">
	import PageFrame from '../lib/integrations/PageFrame.svelte'
	import Library from '../lib/integrations/Library.svelte'
	import { useWorkerLibrary } from '../lib/runtime/worker/context.js'
	const runtime = useWorkerLibrary()
</script>

<PageFrame>
	{#snippet children()}
		{#if runtime.actor}
			{#key runtime.actor}<Library actor={runtime.actor} />{/key}
		{/if}
	{/snippet}
</PageFrame>
