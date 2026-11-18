<script lang="ts">
	import TransactionForm from '../transactions/TransactionForm.svelte'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import { formReasonText } from '../../forms/form-messages.js'
	import type { FinanceWorkerView, WorkerCommandScope } from '../../contracts/worker-application.js'
	import type { WorkerTransactionEntryCommand } from '../../contracts/worker-forms.js'
	import { transactionPages } from '../../domain/transaction-kind.js'
	import { m } from '../../paraglide/messages.js'
	let {
		view,
		onsend
	}: {
		view: FinanceWorkerView
		onsend: (command: WorkerTransactionEntryCommand, scope: WorkerCommandScope) => void
	} = $props()
	const scopeKey = $derived(`${view.sessionRevision}:${view.selection.revision}`)
	function send(command: WorkerTransactionEntryCommand) {
		onsend(command, { sessionRevision: view.sessionRevision, selection: view.selection })
	}
	function values(form: HTMLFormElement) {
		const data = new FormData(form)
		const fields = Object.fromEntries(
			[...data].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
		)
		return {
			...fields,
			tags: data.getAll('tags').filter((entry): entry is string => typeof entry === 'string')
		}
	}
	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (event.currentTarget instanceof HTMLFormElement)
			send({ type: 'SUBMIT', values: values(event.currentTarget) })
	}
	function input(event: Event) {
		if (event.currentTarget instanceof HTMLFormElement)
			send({ type: 'CHANGE', values: values(event.currentTarget) })
	}
	function reset(event: Event) {
		event.preventDefault()
		send({ type: 'RESET' })
	}
</script>

{#if view.transactionEntry}
	{@const entry = view.transactionEntry}
	<FormFeedback
		view={entry.form}
		subject={m['nouns.transaction']({ count: 1 })}
		reasonText={(reason) => formReasonText[reason]()}
		invalidMessage={m['forms.validation_error']()}
		section={entry.form.readiness.kind === 'ready' ? 'readiness' : 'all'}
		onRetryReadiness={() => send({ type: 'RETRY_READINESS' })}
	/>
	{#if entry.form.readiness.kind === 'ready'}
		{#key scopeKey}
			<TransactionForm
				kind={entry.kind}
				paymentEntry={transactionPages[entry.kind].paymentEntry}
				organizationId={view.selection.workspaceId}
				accounts={entry.accounts}
				defaultAccountId={entry.defaultAccountId ?? undefined}
				categories={entry.categories}
				defaultCategoryId={entry.defaultCategoryId ?? undefined}
				tagSuggestions={entry.tagSuggestions}
				view={entry.form}
				onsubmit={submit}
				oninput={input}
				onreset={reset}
				attachmentsEnabled={false}
			/>
		{/key}
	{/if}
{/if}
