<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import { getPageNavigation } from '../navigation/page-navigation.js'
	import PageLayout from '../navigation/PageLayout.svelte'
	import PageHeader from '../navigation/PageHeader.svelte'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import CategoryForm from '../classification/CategoryForm.svelte'
	import TransactionDetails from './TransactionDetails.svelte'
	import TransactionForm from './TransactionForm.svelte'
	import TransactionAttachments from './TransactionAttachments.svelte'
	import InternalTransferDeleteActions from '../transfers/InternalTransferDeleteActions.svelte'
	import { StatusMessage } from 'delightful-ui'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import { transactionPages } from '#lib/domain/transaction-kind.js'
	import { m } from '#lib/paraglide/messages.js'
	import type { WorkerFormCommand } from '#lib/contracts/worker-forms.js'
	import type { WorkerTransferEditCommand } from '#lib/contracts/worker-transfers.js'
	import type { WorkerTransactionImageCommand } from '#lib/contracts/worker-images.js'
	const { client } = getFinanceWorker()
	const liveView = fromStore(client.view)
	const navigation = getPageNavigation()
	const entry = $derived(liveView.current.transactionEdit)
	const transfer = $derived(liveView.current.transferEdit)
	const details = $derived(liveView.current.transactionDetails)
	const category = $derived(liveView.current.classification?.forms.createCategory)
	const createdCategory = $derived(
		category?.content.kind === 'success' ? category.content.value : undefined
	)
	const scope = $derived(
		`${liveView.current.sessionRevision}:${liveView.current.selection.workspaceId}:${liveView.current.transactionId}`
	)
	let categoryModal: CategoryForm | undefined = $state()
	let images = $state<{ id: string; fileId: string; name: string; source: string }[]>([])
	$effect(() => {
		const sources = (details?.images ?? []).map((image) => ({
			id: image.id,
			fileId: image.fileId,
			name: image.file.name,
			source: URL.createObjectURL(image.file)
		}))
		images = sources
		return () => sources.forEach((image) => URL.revokeObjectURL(image.source))
	})
	function send(command: WorkerFormCommand) {
		client.transactionEditCommand(command, liveView.current)
	}
	function transferCommand(command: WorkerTransferEditCommand) {
		client.transferEditCommand(command, liveView.current)
	}
	function imageCommand(command: WorkerTransactionImageCommand) {
		client.transactionImageCommand(command, liveView.current)
	}
	function formCommand(event: Event, type: 'SUBMIT' | 'CHANGE') {
		if (type === 'SUBMIT') event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		const data = new FormData(event.currentTarget)
		send({
			type,
			values: {
				...Object.fromEntries(data),
				tags: data.getAll('tags'),
				attachments: data
					.getAll('attachments')
					.filter((file) => file instanceof File && file.size > 0)
			}
		})
	}
	function categoryCommand(command: WorkerFormCommand) {
		client.classificationCommand('createCategory', command, liveView.current)
	}
</script>

<svelte:head
	><title
		>{m['labels.subject_details']({ subject: m['nouns.transaction']({ count: 1 }) })} · {m[
			'app.name'
		]()}</title
	></svelte:head
>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader
			title={m['labels.subject_details']({ subject: m['nouns.transaction']({ count: 1 }) })}
		/>{/snippet}
	{#if entry}
		{#key scope}
			<FormFeedback
				view={entry.form}
				subject={m['nouns.transaction']({ count: 1 })}
				reasonText={(reason) => formReasonText[reason]()}
				invalidMessage={m['forms.validation_error']()}
				section="readiness"
				onRetryReadiness={() => send({ type: 'RETRY_READINESS' })}
			/>
			{#if entry.initialTransaction}
				<TransactionForm
					mode="edit"
					kind={entry.kind}
					paymentEntry={transactionPages[entry.kind].paymentEntry}
					initialTransaction={entry.initialTransaction}
					organizationId={liveView.current.selection.workspaceId}
					accounts={entry.accounts}
					categories={entry.categories}
					tagSuggestions={entry.tagSuggestions}
					defaultAccountId={entry.initialTransaction.accountId}
					defaultCategoryId={entry.initialTransaction.categoryId}
					view={entry.form}
					attachmentPickerRevision={entry.form.draftRevision}
					onsubmit={(event) => formCommand(event, 'SUBMIT')}
					oninput={(event) => formCommand(event, 'CHANGE')}
					onreset={(event) => {
						event.preventDefault()
						send({ type: 'RESET' })
					}}
					onaddcategory={() => categoryModal?.open()}
					canAddCategory={category?.canOpen ?? false}
					{createdCategory}
					transferSuggestions={transfer?.suggestions ?? []}
					transferEditorState={transfer?.state ?? 'unselected'}
					transferConflict={transfer?.conflict ?? false}
					transferSearchEnabled={transfer?.searchEnabled ?? false}
					selectedTransferCandidateId={transfer?.selectedCandidateId ?? null}
					writableTransferSuggestionIds={new Set(transfer?.writableCandidateIds)}
					transferLinkPending={transfer?.linkPending ?? false}
					transferUnlinkPending={transfer?.unlinkPending ?? false}
					transferUnlinkWritable={transfer?.unlinkWritable ?? false}
					transferUnlinkAvailable={transfer?.unlinkAvailable ?? false}
					transferStatusLabel={transfer?.status ?? null}
					linkedCounterpartHref={transfer?.linkedCounterpartHref ?? null}
					onTransferSearchEnabledChange={(enabled) =>
						transferCommand({ type: enabled ? 'ENABLE_SEARCH' : 'DISABLE_SEARCH' })}
					onSelectTransferCandidate={(candidateId) =>
						transferCommand({ type: 'SELECT_COUNTERPART', candidateId })}
					onLinkCounterpart={(candidateId) =>
						transferCommand({ type: 'LINK_COUNTERPART', candidateId })}
					onUnlinkTransfer={() => transferCommand({ type: 'UNLINK_TRANSFER' })}
				>
					{#snippet savedImages()}
						<TransactionAttachments
							{images}
							canEdit={entry.form.fieldsEditable}
							removingIds={details?.editor?.disabledIds ?? details?.removingIds ?? []}
							failedIds={details?.failedIds ?? []}
							editableIds={details?.editor?.editableIds ?? []}
							onremove={(attachmentId) => imageCommand({ type: 'REMOVE', attachmentId })}
							onedit={(attachmentId) => imageCommand({ type: 'EDIT', attachmentId })}
						/>
						{#if details?.editor?.problem}<StatusMessage
								variant="error"
								text={m['images.edit_failed']()}
							/>{/if}
					{/snippet}
				</TransactionForm>
			{:else if entry.form.readiness.kind === 'ready'}
				<p>{m['transactions.unavailable']()}</p>
			{/if}
			{#if details?.transaction}
				<TransactionDetails
					transaction={details.transaction}
					creatorProfile={details.creatorProfile}
					editorProfile={details.editorProfile}
				>
					{#snippet form()}{/snippet}
					{#snippet actions()}
						<InternalTransferDeleteActions
							transactionId={entry.transactionId}
							available={transfer?.deleteAvailable ?? false}
							pending={transfer?.deletePending ?? false}
							feedback={transfer?.deleteFeedback ?? null}
							onDelete={(choice) => transferCommand({ type: 'DELETE_LINKED_TRANSFER', choice })}
						/>
					{/snippet}
				</TransactionDetails>
			{/if}
		{/key}
		{#if category}
			<CategoryForm
				bind:this={categoryModal}
				{scope}
				fixedKind={entry.kind}
				view={category}
				onopen={() => categoryCommand({ type: 'OPEN' })}
				onsubmit={(event) => {
					event.preventDefault()
					if (event.currentTarget instanceof HTMLFormElement)
						categoryCommand({
							type: 'SUBMIT',
							values: { ...Object.fromEntries(new FormData(event.currentTarget)), kind: entry.kind }
						})
				}}
				onreset={(event) => {
					event.preventDefault()
					categoryCommand({ type: 'RESET' })
				}}
				onRetryReadiness={() => categoryCommand({ type: 'RETRY_READINESS' })}
			>
				{#snippet trigger()}{/snippet}
			</CategoryForm>
		{/if}
	{:else}
		<StatusMessage
			variant={liveView.current.status === 'failed' ? 'error' : 'loading'}
			text={liveView.current.status === 'failed' ? m['forms.load_failed']() : m['status.loading']()}
		/>
	{/if}
</PageLayout>
