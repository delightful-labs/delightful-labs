<script lang="ts">
	import Reader from '../Reader.svelte'
	import type { LibraryClient } from '../../runtime/worker/client.js'
	import { setAccountNavigation } from '../../runtime/navigation.js'
	let { client, id }: { client: LibraryClient; id: string } = $props()
	setAccountNavigation({ open: false })
</script>

<main><Reader actor={client} {id} /></main>
