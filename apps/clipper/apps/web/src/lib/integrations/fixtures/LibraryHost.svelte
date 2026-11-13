<script lang="ts">
	import Library from '../Library.svelte'
	import type { LibraryClient } from '../../runtime/worker/client.js'
	import { setAccountNavigation } from '../../runtime/navigation.js'
	let { client }: { client: LibraryClient } = $props()
	setAccountNavigation({ open: false })
</script>

<Library actor={client} />
