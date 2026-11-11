<script lang="ts">
	import { getWorkspace } from '#lib/runtime/workspace.js'
	import { getJazzSession } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import WorkspaceCreationForm from './WorkspaceCreationForm.svelte'
	const workspace = getWorkspace()
	const session = fromStore(getJazzSession())
	const view = $derived(workspace.view.creation)
</script>

<WorkspaceCreationForm
	scope={session.current.account?.id}
	{view}
	onSubmit={(name) => workspace.actor?.send({ type: 'CREATION', event: { type: 'SUBMIT', name } })}
	onRetry={() => workspace.actor?.send({ type: 'CREATION', event: { type: 'RETRY' } })}
	onNew={() => workspace.actor?.send({ type: 'CREATION', event: { type: 'NEW' } })}
/>
