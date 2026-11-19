<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import type { WorkerFormCommand } from '#lib/contracts/worker-forms.js'
	import PairedTransferForm from './PairedTransferForm.svelte'
	const { client } = getFinanceWorker()
	const state = fromStore(client.view)
	function send(command: WorkerFormCommand) {
		client.transferEntryCommand(command, {
			sessionRevision: state.current.sessionRevision,
			selection: state.current.selection
		})
	}
	function formCommand(event: Event, type: 'SUBMIT' | 'CHANGE') {
		if (type === 'SUBMIT') event.preventDefault()
		if (event.currentTarget instanceof HTMLFormElement)
			send({ type, values: Object.fromEntries(new FormData(event.currentTarget)) })
	}
</script>

{#if state.current.transferCreation}
	{#key `${state.current.sessionRevision}:${state.current.selection.workspaceId}`}
		<PairedTransferForm
			accounts={state.current.transferCreation.accounts}
			view={state.current.transferCreation.form}
			onsubmit={(event) => formCommand(event, 'SUBMIT')}
			oninput={(event) => formCommand(event, 'CHANGE')}
			onreset={(event) => {
				event.preventDefault()
				send({ type: 'RESET' })
			}}
		/>
	{/key}
{/if}
