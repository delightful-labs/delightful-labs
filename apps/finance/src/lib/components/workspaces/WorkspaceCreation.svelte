<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import WorkspaceCreationForm from './WorkspaceCreationForm.svelte'
	const client = getFinanceWorker().client
	const state = fromStore(client.view)
	const scope = $derived(`${state.current.sessionRevision}:${state.current.identityId ?? ''}`)
</script>

{#if state.current.workspaceCreation}
	<WorkspaceCreationForm
		{scope}
		view={state.current.workspaceCreation}
		onSubmit={(name) => client.workspaceCreationCommand({ type: 'SUBMIT', name }, state.current)}
		onRetry={() => client.workspaceCreationCommand({ type: 'RETRY' }, state.current)}
		onNew={() => client.workspaceCreationCommand({ type: 'NEW' }, state.current)}
	/>
{/if}
