<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import InternalTransferEntry from '#lib/components/transfers/InternalTransferEntry.svelte'
</script>

<svelte:head><title>{m['nouns.transfer']({ count: 1 })} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader
			title={m['actions.add_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
		/>{/snippet}

	<InternalTransferEntry />
</PageLayout>
