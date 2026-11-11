<script lang="ts">
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	import type { Snippet } from 'svelte'
	import TransferView from '#lib/components/transfers/TransferView.svelte'
	let { children }: { children: Snippet } = $props()
	const navigation = getPageNavigation()
</script>

<TransferView {navigation} {children} />
