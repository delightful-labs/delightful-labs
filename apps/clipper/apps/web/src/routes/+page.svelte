<script lang="ts">
	import AccountDrawer from '../lib/integrations/AccountDrawer.svelte'
	import Library from '../lib/integrations/Library.svelte'
	import { useWorkerLibrary } from '../lib/runtime/worker/context.js'
	const runtime = useWorkerLibrary()
</script>

<AccountDrawer>
	{#if runtime.actor}
		{#key runtime.actor}<Library actor={runtime.actor} />{/key}
	{/if}
</AccountDrawer>
