<script lang="ts">
	import { debugEnabled } from '#lib/diagnostics/logger.js'
	import { openStateInspector } from '#lib/diagnostics/inspector.js'
	import { type TransactionKind, INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
	import { onMount } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import DeveloperMenuDialog from './DeveloperMenuDialog.svelte'
	import SampleTransactionControls from '../samples/SampleTransactionControls.svelte'
	let { appId, serverUrl }: { appId: string; serverUrl: string } = $props()
	const { client } = getFinanceWorker()
	const liveView = fromStore(client.view)
	const kinds: TransactionKind[] = [INCOME, EXPENSE]
	let browserOrigin = $state<string>()
	onMount(() => {
		browserOrigin = window.location.origin
	})
</script>

{#if debugEnabled}
	<DeveloperMenuDialog
		{appId}
		{serverUrl}
		{browserOrigin}
		accountId={liveView.current.identityId ?? undefined}
		onOpenStateInspector={openStateInspector}
	>
		{#each kinds as kind (kind)}
			<SampleTransactionControls
				{kind}
				busy={liveView.current.samples?.[kind].busy ?? true}
				saved={liveView.current.samples?.[kind].saved ?? 0}
				failed={liveView.current.samples?.[kind].failed ?? false}
				onadd={() => client.addSamples(kind, liveView.current)}
			/>
		{/each}
	</DeveloperMenuDialog>
{/if}
