<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { getBankSync } from '#lib/runtime/bank-sync.js'
	import { m } from '#lib/paraglide/messages.js'

	const bankSync = getBankSync()
</script>

<svelte:head><title>{m['bank.title']()} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['bank.title']()} />{/snippet}
	{@render bankSync.view()}
</PageLayout>
