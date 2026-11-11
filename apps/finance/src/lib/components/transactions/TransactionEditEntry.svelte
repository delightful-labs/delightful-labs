<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { inspectActor } from '#lib/diagnostics/inspector.js'
	import { createLogger } from '#lib/diagnostics/logger.js'
	import { safeBankError } from '#lib/integrations/diagnostics.js'

	const logger = createLogger('transfer-link')
	import { EXPENSE, INCOME, transactionPages } from '#lib/domain/transaction-kind.js'
	import { resolveInternalTransferLinks } from '#lib/domain/internal-transfer.js'
	import { observeRow, observeRows } from '#lib/runtime/observations.js'
	import { createScopedFormController } from '#lib/forms/forms.svelte.js'
	import { app, transactionDetailQuery } from '#lib/schema.js'
	import SavedTransactionImages from './SavedTransactionImages.svelte'
	import {
		applicableTransactionCategories,
		applicableTransactionTags,
		createTransactionEditFormOptions,
		transactionEntryScope,
		writableTransactionAccounts
	} from '#lib/machines/transactions/transaction-entry.js'
	import type { TransactionEntryObservation } from '#lib/contracts/transaction-entry-contract.js'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import {
		createQuerySubscription,
		createQuerySubscriptionOne
	} from 'delightful-local-first/backend/jazz/data'
	import { fromStore } from 'svelte/store'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import {
		accountOrderKey,
		financeFiltersKey,
		type AccountOrder,
		type FinanceFilters
	} from '#lib/filters/finance-filters.js'
	import { getContext, onDestroy, onMount, untrack } from 'svelte'
	import { page } from '$app/state'
	import { orderAccounts } from '#lib/machines/accounts/account-order.js'
	import { stopAfterShutdown } from '#lib/runtime/actor-lifecycle.js'
	import { createActor } from 'xstate'
	import { createTransactionEditMachine } from '#lib/machines/transactions/transaction-edit.js'
	import { transactionAttachmentManagerMachine } from '#lib/machines/transactions/attachments/transaction-attachment-manager.js'
	import { captureTransferMutationScope } from '#lib/machines/runtime/application-readiness.js'
	import { getReadiness } from '#lib/runtime/bank-sync.js'
	import type { TransferWriteTracking } from '#lib/machines/transfers/internal-transfer.js'
	import { m } from '#lib/paraglide/messages.js'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import CategoryForm from '../classification/CategoryForm.svelte'
	import { createManagementFormOptions } from '#lib/machines/management/management.js'
	import { categoryFormSchema } from '#lib/validation/categories.js'
	import { createCategory } from '#lib/data.js'
	import type { ManagementObservation } from '#lib/contracts/management-contract.js'
	import PageHeader from '../navigation/PageHeader.svelte'
	import QueryContent from '../shared/QueryContent.svelte'
	import TransactionDetails from './TransactionDetails.svelte'
	import TransactionForm from './TransactionForm.svelte'
	import InternalTransferDeleteActions from '../transfers/InternalTransferDeleteActions.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const accountOrder = getContext<AccountOrder>(accountOrderKey)
	const db = getDb()
	let selectedAttachments = $state<readonly File[]>([])
	let attachmentPickerRevision = $state(0)
	const readiness = getReadiness()
	const trackTransferWrite = (write: TransferWriteTracking) =>
		readiness.actor.send({ type: 'TRANSFER_WRITE_TRACKED', write })
	const session = fromStore(getJazzSession())
	const routeKind = untrack(() =>
		page.url.pathname.startsWith(transactionPages[INCOME].path) ? INCOME : EXPENSE
	)
	const entryForm = createTransactionEditFormOptions({
		binding: db,
		observe,
		db,
		getAttachments: () => selectedAttachments
	})
	const editWorkflow = createTransactionEditMachine(entryForm, db, trackTransferWrite, {
		captureScope: (request) => captureTransferMutationScope(readiness.actor.getSnapshot(), request),
		send: (event) => readiness.actor.send(event)
	})
	const editActor = createActor(editWorkflow.logic, {
		inspect: inspectActor,
		input: {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: db,
			kind: routeKind,
			transactionId: page.params.id ?? null,
			sessionReady: session.current.status === 'ready',
			loading: true,
			failed: false,
			membership: undefined,
			grants: [],
			accounts: [],
			categories: [],
			tags: [],
			transaction: null
		}
	})
	const attachmentManager = createActor(transactionAttachmentManagerMachine, {
		input: { db, transactionId: page.params.id ?? '' }
	})
	let attachmentManagerSnapshot = $state.raw(attachmentManager.getSnapshot())
	const removingAttachmentIds = $derived([
		...(attachmentManagerSnapshot.context.currentAttachmentId
			? [attachmentManagerSnapshot.context.currentAttachmentId]
			: []),
		...attachmentManagerSnapshot.context.queue
	])
	const failedAttachmentIds = $derived(
		attachmentManagerSnapshot.context.results.flatMap(({ attachmentId, result }) =>
			result.outcome === 'failed' ? [attachmentId] : []
		)
	)
	let editSnapshot = $state.raw(editActor.getSnapshot())
	const formView = $derived(editWorkflow.selectFormView(editSnapshot))
	let observedDraftRevision = $state<number | undefined>(undefined)
	$effect(() => {
		const revision = formView.draftRevision
		if (observedDraftRevision === undefined) {
			observedDraftRevision = revision
			return
		}
		if (revision !== observedDraftRevision) {
			observedDraftRevision = revision
			selectedAttachments = []
			attachmentPickerRevision += 1
		}
		const feedback = formView.feedback
		const completedAfterSave =
			feedback.kind === 'result' &&
			(feedback.result.outcome === 'cancelled' ||
				feedback.result.outcome === 'scopeChanged' ||
				feedback.result.outcome === 'closed') &&
			feedback.result.settlement !== 'notStarted'
		if (
			feedback.kind === 'result' &&
			(feedback.result.outcome === 'succeeded' ||
				(feedback.result.outcome === 'partial' && feedback.result.reason === 'attachmentsFailed') ||
				completedAfterSave) &&
			selectedAttachments.length > 0
		) {
			selectedAttachments = []
			attachmentPickerRevision += 1
		}
	})
	const transferEditorState = $derived(editWorkflow.selectTransferState(editSnapshot))
	const transferSearchEnabled = $derived(
		transferEditorState === 'searching' ||
			transferEditorState === 'matches' ||
			transferEditorState === 'empty' ||
			transferEditorState === 'failed'
	)
	const transferLinkPending = $derived(editWorkflow.isLinkPending(editSnapshot))
	const transferUnlinkPending = $derived(editWorkflow.isUnlinkPending(editSnapshot))
	const transferDeletePending = $derived(editWorkflow.isDeletePending(editSnapshot))
	const transferLinkResult = $derived(editSnapshot.context.linkResult)
	const transferUnlinkResult = $derived(editSnapshot.context.unlinkResult)
	const transferDeleteResult = $derived(editSnapshot.context.deleteResult)
	const selectedTransferCandidateId = $derived(editSnapshot.context.selectedCandidateId)
	$effect(() => {
		const result = transferLinkResult
		if (result?.outcome !== 'unavailable') return
		const error = result.error
		logger.error('operation unavailable', {
			phase: result.phase ?? 'before commit',
			settlement: result.settlement,
			...safeBankError(error)
		})
	})
	const transactionQuery = createQuerySubscriptionOne(() =>
		filters.activeOrganizationId
			? transactionDetailQuery.where({
					id: page.params.id ?? '',
					organizationId: filters.activeOrganizationId
				})
			: undefined
	)
	const transferLinksQuery = createQuerySubscription(() =>
		filters.activeOrganizationId && transactionQuery.current
			? app.internalTransfers.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const counterpartQuery = createQuerySubscription(() => {
		const current = transaction
		const organizationId = filters.activeOrganizationId
		const related = transferLinksQuery.current?.some(
			({ expenseTransactionId, incomeTransactionId }) =>
				expenseTransactionId === current?.id || incomeTransactionId === current?.id
		)
		return (transferSearchEnabled || Boolean(current?.internalTransferId) || related) &&
			current &&
			organizationId
			? app.transactions.where({
					organizationId,
					kind: current.kind === EXPENSE ? INCOME : EXPENSE
				})
			: undefined
	})
	const transferAccountsQuery = createQuerySubscription(() =>
		filters.activeOrganizationId &&
		(transferSearchEnabled ||
			Boolean(transactionQuery.current?.internalTransferId) ||
			linkedTransfer)
			? app.accounts.where({ organizationId: filters.activeOrganizationId }).orderBy('name')
			: undefined
	)
	const membershipQuery = createQuerySubscriptionOne(() =>
		organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
	)
	const grantsQuery = createQuerySubscription(() =>
		filters.activeOrganizationId && session.current.account?.id
			? app.accountMemberships.where({
					organizationId: filters.activeOrganizationId,
					userId: session.current.account.id
				})
			: undefined
	)
	const accountQuery = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const transaction = $derived(observeRow(transactionQuery.current))
	let attachmentImages = $state<{ id: string; fileId: string; name: string; source: string }[]>([])
	$effect(() => {
		const sources = (transaction?.attachments ?? []).flatMap(({ id, file }) => {
			if (!file) return []
			const parts = [...(file.parts ?? [])].sort((left, right) => left.partIndex - right.partIndex)
			const bytes = parts.flatMap((part) => Array.from(part.data ?? []))
			const source = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: file.mimeType }))
			return [{ id, fileId: file.id, name: file.fileName, source }]
		})
		attachmentImages = sources
		return () => sources.forEach(({ source }) => URL.revokeObjectURL(source))
	})
	const categoryQuery = createQuerySubscription(() =>
		filters.activeOrganizationId && transaction?.kind
			? app.categories
					.where({
						organizationId: filters.activeOrganizationId,
						kind: transaction.kind,
						archivedAt: { isNull: true }
					})
					.orderBy('name')
			: undefined
	)
	const tagQuery = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const loadingQueries = [
		transactionQuery,
		membershipQuery,
		grantsQuery,
		accountQuery,
		categoryQuery,
		tagQuery
	]
	function observe(): TransactionEntryObservation {
		const transactionId = page.params.id ?? null
		const organizationId = filters.activeOrganizationId
		const current = transaction
		return {
			identityId: session.current.account?.id ?? null,
			organizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			kind: current?.kind ?? routeKind,
			transactionId,
			membership: observeRow(membershipQuery.current),
			grants: observeRows(grantsQuery.current),
			accounts: observeRows(accountQuery.current),
			categories: observeRows(categoryQuery.current),
			tags: observeRows(tagQuery.current),
			loading: loadingQueries.some((query) => query.isLoading),
			failed: loadingQueries.some((query) => query.error != null),
			transaction:
				current?.id === transactionId && current.organizationId === organizationId ? current : null
		}
	}
	onMount(() => {
		const subscription = editActor.subscribe({ next: (snapshot) => (editSnapshot = snapshot) })
		const attachmentSubscription = attachmentManager.subscribe({
			next: (snapshot) => (attachmentManagerSnapshot = snapshot)
		})
		editActor.start()
		attachmentManager.start()
		return () => {
			subscription.unsubscribe()
			attachmentSubscription.unsubscribe()
		}
	})
	$effect(() => {
		const observation = observe()
		untrack(() => editActor.send({ type: 'OBSERVE', observation }))
	})
	$effect(() => {
		const transactionId = page.params.id ?? ''
		untrack(() => attachmentManager.send({ type: 'SCOPE', transactionId }))
	})
	onDestroy(() => {
		stopAfterShutdown(editActor)
		stopAfterShutdown(attachmentManager)
	})

	function valuesFromForm(form: HTMLFormElement) {
		const data = new FormData(form)
		return {
			...Object.fromEntries(data),
			tags: data.getAll('tags'),
			attachments: data
				.getAll('attachments')
				.filter((file) => file instanceof File && file.size > 0)
		}
	}
	function submitForm(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		editActor.send({ type: 'OBSERVE', observation: observe() })
		editActor.send({
			type: 'FORM',
			event: { type: 'SUBMIT', values: valuesFromForm(event.currentTarget) }
		})
	}
	function updateAttachments(files: readonly File[]) {
		selectedAttachments = files
	}
	function removeAttachment(attachmentId: string) {
		attachmentManager.send({ type: 'REMOVE', attachmentId })
	}
	function inputForm(event: Event) {
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		editActor.send({ type: 'OBSERVE', observation: observe() })
		editActor.send({
			type: 'FORM',
			event: { type: 'CHANGE', values: valuesFromForm(event.currentTarget) }
		})
	}
	function resetForm(event: Event) {
		event.preventDefault()
		editActor.send({ type: 'FORM', event: { type: 'RESET' } })
	}
	function retryReadiness() {
		editActor.send({ type: 'FORM', event: { type: 'RETRY_READINESS' } })
	}
	const availableAccounts = $derived(
		orderAccounts(writableTransactionAccounts(observe()), accountOrder.ids)
	)
	const availableCategories = $derived(applicableTransactionCategories(observe()))
	const tagSuggestions = $derived(applicableTransactionTags(observe()).map((tag) => tag.name))
	const counterpartRows = $derived(observeRows(counterpartQuery.current))
	const transferLinks = $derived(observeRows(transferLinksQuery.current))
	const currentHasRelatedTransfer = $derived(
		transferLinks.some(
			({ expenseTransactionId, incomeTransactionId }) =>
				expenseTransactionId === transaction?.id || incomeTransactionId === transaction?.id
		)
	)
	const transferResolution = $derived(
		resolveInternalTransferLinks(
			transferLinks,
			transaction ? [transaction, ...counterpartRows] : counterpartRows
		)
	)
	const effectiveTransferLink = $derived(
		transferResolution.effectiveLinks.find(
			({ expenseTransactionId, incomeTransactionId }) =>
				expenseTransactionId === transaction?.id || incomeTransactionId === transaction?.id
		) ?? null
	)
	const effectiveTransfer = $derived(
		effectiveTransferLink
			? (transferLinks.find(({ id }) => id === effectiveTransferLink.id) ?? null)
			: null
	)
	const pendingTransferLink = $derived(
		transferResolution.pendingLinks.find(
			({ expenseTransactionId, incomeTransactionId }) =>
				expenseTransactionId === transaction?.id || incomeTransactionId === transaction?.id
		) ?? null
	)
	const pendingTransfer = $derived(
		pendingTransferLink
			? (transferLinks.find(({ id }) => id === pendingTransferLink.id) ?? null)
			: null
	)
	const counterpartObservationRequired = $derived(
		transferSearchEnabled || Boolean(transaction?.internalTransferId) || currentHasRelatedTransfer
	)
	const transferObservationsSettled = $derived(
		!transferLinksQuery.isLoading &&
			(!counterpartObservationRequired || !counterpartQuery.isLoading)
	)
	const transferConflict = $derived.by(() => {
		if (!transaction || !transferObservationsSettled) return false
		const currentId = transaction.id
		const resolvedTransfer = effectiveTransfer ?? pendingTransfer
		const relatedIds = new Set([currentId])
		if (resolvedTransfer)
			relatedIds.add(
				resolvedTransfer.expenseTransactionId === currentId
					? resolvedTransfer.incomeTransactionId
					: resolvedTransfer.expenseTransactionId
			)
		const hasConflictingLink = transferResolution.conflictedLinks.some(
			({ expenseTransactionId, incomeTransactionId }) =>
				relatedIds.has(expenseTransactionId) || relatedIds.has(incomeTransactionId)
		)
		const hasOrphanMarker =
			transaction.internalTransferId != null &&
			!transferLinks.some(
				({ id, expenseTransactionId, incomeTransactionId }) =>
					id === transaction.internalTransferId &&
					(expenseTransactionId === currentId || incomeTransactionId === currentId)
			)
		return hasConflictingLink || hasOrphanMarker
	})
	const linkedTransfer = $derived(transferConflict ? null : (effectiveTransfer ?? pendingTransfer))
	const linkedCounterpartHref = $derived.by(() => {
		if (!linkedTransfer || !transaction) return null
		const counterpartId =
			linkedTransfer.expenseTransactionId === transaction.id
				? linkedTransfer.incomeTransactionId
				: linkedTransfer.incomeTransactionId === transaction.id
					? linkedTransfer.expenseTransactionId
					: null
		if (!counterpartId) return null
		const counterpartKind = transaction.kind === EXPENSE ? INCOME : EXPENSE
		return `${transactionPages[counterpartKind].path}/${encodeURIComponent(counterpartId)}`
	})
	const linkedTransactionIds = $derived(
		new Set(transferLinks.flatMap((link) => [link.expenseTransactionId, link.incomeTransactionId]))
	)
	const transferSuggestions = $derived(
		editSnapshot.context.candidates.map((candidate) => ({
			...candidate,
			description: counterpartRows.find(({ id }) => id === candidate.id)?.description,
			accountName: transferAccountsQuery.current?.find(
				(account) => account.id === candidate.accountId
			)?.name
		}))
	)
	const writableTransferSuggestionIds = $derived(editWorkflow.writableCandidateIds(editSnapshot))
	const transferUnlinkWritable = $derived(editWorkflow.unlinkWritable(editSnapshot))
	$effect(() => {
		const searchEnabled = transferSearchEnabled
		const linked = linkedTransfer !== null
		const conflicted = transferConflict
		const previouslyObserved = ['linked', 'conflicted'].includes(transferEditorState)
		if (!searchEnabled && !linked && !conflicted && !previouslyObserved) return
		const observation = {
			rows: counterpartRows,
			scope: transactionEntryScope(observe()),
			scopeGeneration: untrack(() => editActor.getSnapshot().context.scopeGeneration),
			linkedTransactionIds: [...linkedTransactionIds],
			linkedTransfer,
			linked,
			conflicted,
			searchEnabled,
			pendingUnlink: Boolean(linkedTransfer && pendingTransfer?.id === linkedTransfer.id),
			loading:
				counterpartQuery.isLoading ||
				transferLinksQuery.isLoading ||
				transferAccountsQuery.isLoading,
			failed:
				counterpartQuery.error != null ||
				transferLinksQuery.error != null ||
				transferAccountsQuery.error != null
		}
		untrack(() => editActor.send({ type: 'TRANSFER_OBSERVATION', observation }))
	})
	function linkCounterpart(transactionId: string) {
		editActor.send({ type: 'LINK_COUNTERPART', candidateId: transactionId })
	}
	function selectTransferCandidate(transactionId: string) {
		editActor.send({ type: 'SELECT_COUNTERPART', candidateId: transactionId })
	}
	function unlinkTransfer() {
		editActor.send({ type: 'UNLINK_TRANSFER' })
	}
	function deleteLinkedTransfer(
		choice: import('#lib/machines/transfers/internal-transfer.js').InternalTransferDeleteChoice
	) {
		editActor.send({ type: 'DELETE_LINKED_TRANSFER', choice })
	}
	const creatorQuery = createQuerySubscriptionOne(() =>
		transaction ? app.profiles.where({ userId: transaction.$createdBy.account }) : undefined
	)
	const editorQuery = createQuerySubscriptionOne(() =>
		transaction ? app.profiles.where({ userId: transaction.$updatedBy.account }) : undefined
	)
	const initialTransaction = $derived.by(() => {
		const row = transaction
		if (!row) return undefined
		return {
			accountId: row.accountId,
			categoryId: row.categoryId,
			amountMinor: row.amountMinor,
			currency: row.currency,
			accountName: row.account?.name,
			categoryName: row.category?.name,
			bookedOn: row.bookedOn,
			...(row.description ? { description: row.description } : {}),
			...(row.memo ? { memo: row.memo } : {}),
			...(row.checkId ? { checkId: row.checkId } : {}),
			...(row.paymentMethod ? { paymentMethod: row.paymentMethod } : {}),
			...(row.check
				? {
						check: {
							checkNumber: row.check.checkNumber,
							checkDate: row.check.checkDate ?? ''
						}
					}
				: {}),
			tags: row.tags?.flatMap((link) => (link.tag?.name ? [link.tag.name] : [])) ?? []
		}
	})
	let categoryModal: CategoryForm | undefined = $state()
	const categoryScope = $derived({
		identityId: session.current.account?.id ?? null,
		organizationId: filters.activeOrganizationId,
		binding: session.current.client?.db ?? null
	})
	function observeCategory(): ManagementObservation {
		return {
			...categoryScope,
			sessionReady: session.current.status === 'ready',
			membership: observeRow(membershipQuery.current),
			categories: observeRows(categoryQuery.current),
			tags: [],
			loading: [membershipQuery, categoryQuery, transactionQuery].some((q) => q.isLoading),
			failed: [membershipQuery, categoryQuery, transactionQuery].some((q) => q.error != null)
		}
	}
	const categoryOptions = createManagementFormOptions({ binding: db, observe: observeCategory })({
		schema: categoryFormSchema,
		successContent: 'replace',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: {
				kind: 'createCategory',
				name: request.values.name,
				categoryKind: request.values.kind
			}
		}),
		write: ({ request }) => {
			const organizationId = request.scope.organizationId
			if (!organizationId) throw new Error('Missing authorized workspace')
			return createCategory(db, organizationId, request.values.name, request.values.kind)
		}
	})
	const categoryController = createScopedFormController(categoryOptions)
	const createdCategory = $derived(
		categoryController.view.content.kind === 'success'
			? categoryController.view.content.value
			: undefined
	)
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

	<QueryContent
		queries={[transactionQuery]}
		loadingMessage={m['status.loading_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
		errorMessage={m['errors.load_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
	>
		{#key `${session.current.account?.id}:${filters.activeOrganizationId}:${page.params.id}`}
			<TransactionDetails
				transaction={observe().transaction}
				creatorProfile={creatorQuery.current}
				editorProfile={editorQuery.current}
			>
				{#snippet actions()}
					<InternalTransferDeleteActions
						transactionId={transaction?.id ?? page.params.id ?? ''}
						available={Boolean(
							linkedTransfer &&
							formView.fieldsEditable &&
							transferDeleteResult?.outcome !== 'succeeded'
						)}
						pending={transferDeletePending}
						feedback={editWorkflow.selectDeleteFeedback(editSnapshot)}
						onDelete={deleteLinkedTransfer}
					/>
				{/snippet}
				{#snippet form()}
					<FormFeedback
						view={formView}
						subject={m['nouns.transaction']({ count: 1 })}
						reasonText={(reason) => formReasonText[reason]()}
						invalidMessage={m['forms.validation_error']()}
						section="readiness"
						onRetryReadiness={retryReadiness}
					/>
					{#if initialTransaction && transaction}
						<TransactionForm
							mode="edit"
							onaddcategory={() => categoryModal?.open()}
							canAddCategory={categoryController.view.canOpen}
							{createdCategory}
							kind={transaction.kind}
							paymentEntry={transactionPages[transaction.kind].paymentEntry}
							{initialTransaction}
							oninput={inputForm}
							onattachmentschange={updateAttachments}
							{attachmentPickerRevision}
							organizationId={filters.activeOrganizationId}
							accounts={availableAccounts}
							defaultAccountId={initialTransaction.accountId}
							categories={availableCategories}
							defaultCategoryId={initialTransaction.categoryId}
							{tagSuggestions}
							{transferSuggestions}
							{transferEditorState}
							{transferConflict}
							{selectedTransferCandidateId}
							onSelectTransferCandidate={selectTransferCandidate}
							{transferSearchEnabled}
							{writableTransferSuggestionIds}
							onTransferSearchEnabledChange={(enabled) =>
								editActor.send({ type: enabled ? 'ENABLE_SEARCH' : 'DISABLE_SEARCH' })}
							{transferLinkPending}
							{transferLinkResult}
							transferStatusLabel={editWorkflow.selectTransferStatus(editSnapshot)}
							transferUnlinkAvailable={linkedTransfer !== null}
							{transferUnlinkWritable}
							{transferUnlinkPending}
							{transferUnlinkResult}
							{linkedCounterpartHref}
							onLinkCounterpart={linkCounterpart}
							onUnlinkTransfer={unlinkTransfer}
							view={formView}
							onsubmit={submitForm}
							onreset={resetForm}
						>
							{#snippet savedImages()}
								{#if transaction}
									{#key `${transaction.id}:${transaction.accountId}:${transaction.organizationId}`}
										<SavedTransactionImages
											{db}
											{transaction}
											images={attachmentImages}
											canEdit={formView.fieldsEditable}
											removingIds={removingAttachmentIds}
											failedIds={failedAttachmentIds}
											onremove={removeAttachment}
										/>
									{/key}
								{/if}
							{/snippet}
						</TransactionForm>
					{/if}
				{/snippet}
			</TransactionDetails>
		{/key}
	</QueryContent>

	{#if transaction}
		<CategoryForm
			bind:this={categoryModal}
			scope={categoryScope}
			fixedKind={transaction.kind}
			view={categoryController.view}
			onopen={categoryController.open}
			onsubmit={(event) => {
				event.preventDefault()
				if (!(event.currentTarget instanceof HTMLFormElement) || !transaction) return
				categoryController.submitValues({
					name: new FormData(event.currentTarget).get('name'),
					kind: transaction.kind
				})
			}}
			onreset={categoryController.reset}
			onRetryReadiness={categoryController.retryReadiness}
		>
			{#snippet trigger()}{/snippet}
		</CategoryForm>
	{/if}
</PageLayout>
