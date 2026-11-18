<script lang="ts">
	import AccountForm from '../accounts/AccountForm.svelte'
	import type { FinanceWorkerView, WorkerCommandScope } from '../../contracts/worker-application.js'
	import type { WorkerAccountCreationCommand } from '../../contracts/worker-forms.js'
	let {
		view,
		onsend
	}: {
		view: FinanceWorkerView
		onsend: (command: WorkerAccountCreationCommand, scope: WorkerCommandScope) => void
	} = $props()
	const scopeKey = $derived(`${view.sessionRevision}:${view.selection.revision}`)
	const currency = $derived(
		view.workspaces?.find((row) => row.id === view.selection.workspaceId)?.defaultCurrency ?? 'USD'
	)
	function send(command: WorkerAccountCreationCommand) {
		onsend(command, { sessionRevision: view.sessionRevision, selection: view.selection })
	}
	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		send({ type: 'SUBMIT', values: Object.fromEntries(new FormData(event.currentTarget)) })
	}
	function reset(event: Event) {
		event.preventDefault()
		send({ type: 'RESET' })
	}
</script>

{#if view.accountCreation}
	<AccountForm
		scope={scopeKey}
		defaultCurrency={currency}
		view={view.accountCreation}
		onopen={() => send({ type: 'OPEN' })}
		onsubmit={submit}
		onreset={reset}
		onRetryReadiness={() => send({ type: 'RETRY_READINESS' })}
	/>
{/if}
