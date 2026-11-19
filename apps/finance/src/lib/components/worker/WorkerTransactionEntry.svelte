<script lang="ts">
	import TransactionForm from '../transactions/TransactionForm.svelte'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import { formReasonText } from '../../forms/form-messages.js'
	import type { FinanceWorkerView, WorkerCommandScope } from '../../contracts/worker-application.js'
	import type { WorkerFormCommand } from '../../contracts/worker-forms.js'
	import { transactionPages } from '../../domain/transaction-kind.js'
	import { m } from '../../paraglide/messages.js'
	let {
		view,
		entry = view.transactionEntry,
		onsend,
		oncancel
	}: {
		entry?: FinanceWorkerView['transactionEntry'] | FinanceWorkerView['transactionEdit']
		view: FinanceWorkerView
		oncancel?: (() => void) | undefined
		onsend: (command: WorkerFormCommand, scope: WorkerCommandScope) => void
	} = $props()
	const scopeKey = $derived(`${view.sessionRevision}:${view.selection.revision}`)
	function send(command: WorkerFormCommand) {
		onsend(command, { sessionRevision: view.sessionRevision, selection: view.selection })
	}
	function values(form: HTMLFormElement) {
		const data = new FormData(form)
		const fields = Object.fromEntries(
			[...data].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
		)
		return {
			...fields,
			tags: data.getAll('tags').filter((entry): entry is string => typeof entry === 'string'),
			attachments: data
				.getAll('attachments')
				.filter((entry): entry is File => entry instanceof File && entry.size > 0)
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

{#if entry}
	<FormFeedback
		view={entry.form}
		subject={m['nouns.transaction']({ count: 1 })}
		reasonText={(reason) => formReasonText[reason]()}
		invalidMessage={m['forms.validation_error']()}
		section={entry.form.readiness.kind === 'ready' ? 'readiness' : 'all'}
		onRetryReadiness={() => send({ type: 'RETRY_READINESS' })}
	/>
	{#if entry.form.readiness.kind === 'ready' || ('initialTransaction' in entry && entry.initialTransaction)}
		{#key scopeKey}
			<TransactionForm
				mode={'transactionId' in entry ? 'edit' : 'create'}
				initialTransaction={'initialTransaction' in entry
					? (entry.initialTransaction ?? undefined)
					: undefined}
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
				{oncancel}
				attachmentPickerRevision={entry.form.draftRevision}
			/>
		{/key}
	{/if}
{/if}
