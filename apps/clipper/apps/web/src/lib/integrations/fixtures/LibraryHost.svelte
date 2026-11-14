<script lang="ts">
	import Library from '../Library.svelte'
	import type { LibraryClient } from '../../runtime/worker/client.js'
	let { client }: { client: LibraryClient } = $props()
</script>

<Library actor={client} />
