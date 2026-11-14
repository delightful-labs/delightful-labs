<script lang="ts">
	import type { LibraryClient } from '../client.js'
	let { client }: { client: LibraryClient } = $props()
	const message = $derived($client.view.captureFeedback)
</script>

<output aria-label="Can add">{$client.canAdd}</output>
<output aria-label="Can organize">{$client.view.canOrganize}</output>
{#if message}<p role="status" data-variant={message.variant}>{message.text}</p>{/if}
