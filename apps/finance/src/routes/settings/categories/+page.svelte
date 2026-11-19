<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import WorkerClassification from '#lib/components/worker/WorkerClassification.svelte'
	import { m } from '#lib/paraglide/messages.js'
	const client = getFinanceWorker().client
	const state = fromStore(client.view)
	const navigation = getPageNavigation()
</script>

<svelte:head><title>{m['nouns.category']({ count: 2 })} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['nouns.category']({ count: 2 })} />{/snippet}
	<WorkerClassification
		view={state.current}
		kind="category"
		onsend={client.classificationCommand}
	/>
</PageLayout>
