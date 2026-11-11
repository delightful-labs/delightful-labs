<script lang="ts">
	import { PAYMENT_METHOD } from '#lib/domain/payment-method.js'
	import type { TransactionKind, TransactionPaymentEntry } from '#lib/domain/transaction-kind.js'
	import {
		Button,
		InputText,
		InputDate,
		Select,
		Textarea,
		InputCurrency,
		FieldFeedback
	} from 'delightful-ui'
	import { untrack, tick, type Snippet } from 'svelte'
	import { amountInputPattern, minorUnitsToInput } from '#lib/domain/money.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import type { Account, Category, Tag, TransactionDetail } from '#lib/schema.js'
	import type { InternalTransferCandidate } from '#lib/domain/internal-transfer.js'
	import type {
		InternalTransferLinkResult,
		InternalTransferUnlinkResult
	} from '#lib/machines/transfers/internal-transfer.js'
	import type {
		TransactionEditTransferState,
		TransferStatusLabel
	} from '#lib/machines/transactions/transaction-edit.js'
	import type { TransactionEntryView } from '#lib/contracts/transaction-entry-contract.js'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from '../forms/FormContent.svelte'
	import TransactionCheckFields from './TransactionCheckFields.svelte'
	import TransactionTagInput from './TransactionTagInput.svelte'
	import InternalTransferSuggestions from '../transfers/InternalTransferSuggestions.svelte'
	import TransactionImageInput from './TransactionImageInput.svelte'

	let {
		kind,
		paymentEntry,
		mode = 'create',
		initialTransaction,
		organizationId,
		accounts,
		defaultAccountId,
		categories,
		defaultCategoryId,
		tagSuggestions,
		view,
		onsubmit,
		onreset,
		oncancel,
		oninput,
		onattachmentschange,
		savedImages,
		attachmentPickerRevision = 0,
		onaddcategory,
		canAddCategory = false,
		createdCategory,
		transferSuggestions = [],
		transferSearchEnabled = false,
		transferEditorState = 'unselected',
		transferConflict = false,
		selectedTransferCandidateId = null,
		writableTransferSuggestionIds = new Set<string>(),
		transferLinkPending = false,
		transferLinkResult = null,
		transferStatusLabel = null,
		transferUnlinkAvailable = false,
		transferUnlinkWritable = false,
		transferUnlinkPending = false,
		transferUnlinkResult = null,
		linkedCounterpartHref = null,
		onLinkCounterpart,
		onTransferSearchEnabledChange,
		onSelectTransferCandidate,
		onUnlinkTransfer
	}: {
		kind: TransactionKind
		paymentEntry: TransactionPaymentEntry
		mode?: 'create' | 'edit'
		initialTransaction?: Pick<
			TransactionDetail,
			'accountId' | 'categoryId' | 'amountMinor' | 'currency' | 'bookedOn'
		> &
			Partial<Pick<TransactionDetail, 'description' | 'memo' | 'paymentMethod' | 'checkId'>> & {
				accountName?: Account['name'] | undefined
				categoryName?: Category['name'] | undefined
				check?: Pick<NonNullable<TransactionDetail['check']>, 'checkNumber' | 'checkDate'>
				tags: readonly Tag['name'][]
			}
		organizationId: TransactionDetail['organizationId'] | null
		accounts: readonly Account[]
		defaultAccountId: Account['id'] | undefined
		categories: readonly Category[]
		defaultCategoryId: Category['id'] | undefined
		tagSuggestions: readonly Tag['name'][]
		view: TransactionEntryView
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		oncancel?: () => void
		onaddcategory?: () => void
		canAddCategory?: boolean
		createdCategory?: Category | undefined
		oninput?: (event: Event) => void
		savedImages?: Snippet
		onattachmentschange?: (files: readonly File[]) => void
		attachmentPickerRevision?: number
		transferSuggestions?: readonly (InternalTransferCandidate & {
			accountName: Account['name'] | undefined
			description: TransactionDetail['description'] | undefined
		})[]
		transferSearchEnabled?: boolean
		transferEditorState?: TransactionEditTransferState
		transferConflict?: boolean
		selectedTransferCandidateId?: string | null
		onTransferSearchEnabledChange?: (enabled: boolean) => void
		onSelectTransferCandidate?: (transactionId: string) => void
		writableTransferSuggestionIds?: ReadonlySet<string>
		transferLinkPending?: boolean
		transferLinkResult?: InternalTransferLinkResult | null
		transferStatusLabel?: TransferStatusLabel | null
		transferUnlinkAvailable?: boolean
		transferUnlinkWritable?: boolean
		transferUnlinkPending?: boolean
		transferUnlinkResult?: InternalTransferUnlinkResult | null
		linkedCounterpartHref?: string | null
		onLinkCounterpart?: (transactionId: string) => void
		onUnlinkTransfer?: () => void
	} = $props()

	const resetRevision = $derived(view.draftRevision)
	let activeCheckFieldsKey = $state('')
	let selectedAccountId = $state('')
	const selectedAccountCurrency = $derived(
		accounts.find((account) => account.id === selectedAccountId)?.currency ??
			initialTransaction?.currency ??
			'USD'
	)
	let appliedCategoryId = $state<string>()
	let categorySelect: HTMLSelectElement | undefined = $state()
	$effect(() => {
		const category = createdCategory
		const element = categorySelect
		if (
			!category ||
			!element ||
			appliedCategoryId === category.id ||
			!categories.some((row) => row.id === category.id)
		)
			return
		untrack(() => {
			appliedCategoryId = category.id
			element.value = category.id
			element.dispatchEvent(new Event('input', { bubbles: true }))
		})
	})
	$effect(() => {
		void resetRevision
		untrack(() => {
			activeCheckFieldsKey =
				initialTransaction?.paymentMethod === PAYMENT_METHOD.CHECK ? PAYMENT_METHOD.CHECK : ''
			selectedAccountId = initialTransaction?.accountId ?? defaultAccountId ?? ''
		})
	})
	function syncPaymentMethod(element: HTMLSelectElement) {
		activeCheckFieldsKey = element.value === PAYMENT_METHOD.CHECK ? PAYMENT_METHOD.CHECK : ''
		void tick().then(() => element.dispatchEvent(new Event('input', { bubbles: true })))
	}
	const issues = $derived(
		view.feedback.kind === 'result' && view.feedback.result.outcome === 'invalid'
			? view.feedback.result.issues
			: []
	)
	const attachmentIssue = $derived(issues.find(({ path }) => path[0] === 'attachments'))

	// Finance maps validation paths to translated messages; the UI stays independent of Zod.
	function fieldInvalid(issues: readonly { path: readonly PropertyKey[] }[], field: string) {
		return issues.some(
			({ path }) =>
				path[0] === field ||
				(field === 'amount' && path[0] === 'money') ||
				(path[0] === 'check' && path[path.length - 1] === field)
		)
	}
</script>

{#key `${organizationId}:${kind}`}
	<FormContent {view} {onsubmit} {onreset} {oninput}>
		{#snippet fields(form)}
			{#if form.content.kind !== 'success'}
				<Select
					label={m['nouns.account']({ count: 1 })}
					id="transaction-account"
					aria-describedby="transaction-account-feedback"
					aria-invalid={fieldInvalid(issues, 'accountId') || undefined}
					name="accountId"
					required
					defaultValue={initialTransaction?.accountId ?? defaultAccountId ?? ''}
					bind:value={selectedAccountId}
				>
					<option value="" disabled
						>{m['actions.select_subject']({ subject: m['nouns.account']({ count: 1 }) })}</option
					>
					{#if initialTransaction && !accounts.some((account) => account.id === initialTransaction?.accountId)}
						<option value={initialTransaction.accountId} disabled
							>{initialTransaction.accountName ??
								m['status.unavailable_subject']({
									subject: m['nouns.account']({ count: 1 })
								})} · {initialTransaction.currency}</option
						>
					{/if}
					{#each accounts as account (account.id)}
						<option value={account.id}>{account.name} · {account.currency}</option>
					{/each}
				</Select>
				<FieldFeedback
					id="transaction-account-feedback"
					errorMessage={fieldInvalid(issues, 'accountId')
						? m['forms.select_subject']({ subject: m['nouns.account']({ count: 1 }) })
						: ''}
				/>

				<Select
					label={m['nouns.category']({ count: 1 })}
					id="transaction-category"
					{@attach (element) => {
						categorySelect = element
						return () => {
							categorySelect = undefined
						}
					}}
					aria-describedby="transaction-category-feedback"
					aria-invalid={fieldInvalid(issues, 'categoryId') || undefined}
					name="categoryId"
					required
					defaultValue={initialTransaction?.categoryId ?? defaultCategoryId ?? ''}
				>
					<option value="" disabled>
						{m['actions.select_subject']({ subject: m['nouns.category']({ count: 1 }) })}
					</option>
					{#if initialTransaction && !categories.some((category) => category.id === initialTransaction?.categoryId)}
						<option value={initialTransaction.categoryId} disabled
							>{initialTransaction.categoryName ??
								m['status.unavailable_subject']({
									subject: m['nouns.category']({ count: 1 })
								})}</option
						>
					{/if}
					{#each categories as category (category.id)}
						<option value={category.id}>
							{category.name}
						</option>
					{/each}
				</Select>
				{#if onaddcategory}
					<Button type="button" disabled={!canAddCategory} onclick={onaddcategory}>
						{m['actions.add_subject']({ subject: m['nouns.category']({ count: 1 }) })}
					</Button>
				{/if}
				<FieldFeedback
					id="transaction-category-feedback"
					errorMessage={fieldInvalid(issues, 'categoryId')
						? m['forms.select_subject']({ subject: m['nouns.category']({ count: 1 }) })
						: ''}
				/>

				<InputCurrency
					label={m['labels.amount']()}
					currencyLabel={selectedAccountCurrency}
					id="transaction-amount"
					aria-describedby="transaction-amount-feedback"
					aria-invalid={fieldInvalid(issues, 'amount') || undefined}
					name="amount"
					inputmode="decimal"
					autocomplete="off"
					pattern={amountInputPattern(selectedAccountCurrency)}
					defaultValue={initialTransaction
						? minorUnitsToInput(initialTransaction.amountMinor, initialTransaction.currency)
						: ''}
					required
				/>
				<FieldFeedback
					id="transaction-amount-feedback"
					errorMessage={fieldInvalid(issues, 'amount')
						? m['forms.enter_subject']({ subject: m['labels.amount']() })
						: ''}
				/>

				<InputDate
					label={m['nouns.date']({ count: 1 })}
					id="transaction-date"
					aria-describedby="transaction-date-feedback"
					aria-invalid={fieldInvalid(issues, 'bookedOn') || undefined}
					name="bookedOn"
					defaultValue={initialTransaction?.bookedOn ?? todayDateOnly()}
					required
				/>
				<FieldFeedback
					id="transaction-date-feedback"
					errorMessage={fieldInvalid(issues, 'bookedOn')
						? m['forms.enter_subject']({ subject: m['nouns.date']({ count: 1 }) })
						: ''}
				/>

				{#if paymentEntry === 'inline'}
					<Select
						label={m['labels.subject_method']({ subject: m['nouns.payment']({ count: 1 }) })}
						id="transaction-payment-method"
						aria-describedby="transaction-payment-method-feedback"
						aria-invalid={fieldInvalid(issues, 'paymentMethod') || undefined}
						name="paymentMethod"
						defaultValue={initialTransaction?.paymentMethod ?? ''}
						{@attach syncPaymentMethod}
						onchange={(event) => syncPaymentMethod(event.currentTarget)}
					>
						<option value="">{m['labels.unspecified']()}</option>
						<option value={PAYMENT_METHOD.CASH}>{m['labels.cash']()}</option>
						<option value={PAYMENT_METHOD.CHECK}>{m['nouns.check']({ count: 1 })}</option>
						<option value={PAYMENT_METHOD.TRANSFER}>{m['transactions.payment.transfer']()}</option>
						<option value={PAYMENT_METHOD.ELECTRONIC}
							>{m['transactions.payment.electronic']()}</option
						>
					</Select>
					<FieldFeedback
						id="transaction-payment-method-feedback"
						errorMessage={fieldInvalid(issues, 'paymentMethod')
							? m['forms.enter_subject']({
									subject: m['labels.subject_method']({ subject: m['nouns.payment']({ count: 1 }) })
								})
							: ''}
					/>

					{#key resetRevision}
						<TransactionCheckFields
							active={activeCheckFieldsKey === PAYMENT_METHOD.CHECK}
							{issues}
							initialCheck={initialTransaction?.checkId && initialTransaction.check
								? { id: initialTransaction.checkId, ...initialTransaction.check }
								: undefined}
						/>
					{/key}
				{/if}

				{#if paymentEntry === 'preserve' && initialTransaction?.paymentMethod}
					<input type="hidden" name="paymentMethod" value={initialTransaction.paymentMethod} />
					{#if initialTransaction.checkId}<input
							type="hidden"
							name="checkId"
							value={initialTransaction.checkId}
						/>{/if}
				{/if}
				{#if organizationId}
					<TransactionTagInput
						{organizationId}
						suggestions={tagSuggestions}
						initialTags={initialTransaction?.tags ?? []}
						disabled={!form.fieldsEditable}
					/>
				{/if}
				{#if mode === 'edit' && onLinkCounterpart && transferEditorState !== 'linked' && transferEditorState !== 'conflicted' && !transferConflict}
					<label>
						<input
							type="checkbox"
							checked={transferSearchEnabled}
							onchange={(event) => onTransferSearchEnabledChange?.(event.currentTarget.checked)}
						/>
						{m['transfers.convert_to_transfer']()}
					</label>
				{/if}
				{#if mode === 'edit' && onLinkCounterpart && transferEditorState !== 'unselected'}
					<InternalTransferSuggestions
						suggestions={transferSuggestions}
						writableSuggestionIds={writableTransferSuggestionIds}
						editorState={transferConflict ? 'conflicted' : transferEditorState}
						selectedId={selectedTransferCandidateId}
						onSelect={onSelectTransferCandidate}
						pending={transferLinkPending}
						statusLabel={transferStatusLabel}
						unlinkAvailable={transferUnlinkAvailable}
						unlinkWritable={transferUnlinkWritable}
						unlinkPending={transferUnlinkPending}
						{linkedCounterpartHref}
						onLink={onLinkCounterpart}
						onUnlink={onUnlinkTransfer}
					/>
				{/if}
				<InputText
					label={m['labels.description']()}
					id="transaction-description"
					name="description"
					defaultValue={initialTransaction?.description ?? ''}
				/>
				<Textarea
					label={m['labels.memo']()}
					id="transaction-memo"
					name="memo"
					defaultValue={initialTransaction?.memo ?? ''}
				></Textarea>
			{/if}
		{/snippet}
		{#snippet supplemental(form)}
			{#if form.content.kind !== 'success'}
				{#key attachmentPickerRevision}
					<TransactionImageInput
						disabled={!form.fieldsEditable}
						invalid={attachmentIssue !== undefined}
						describedby={attachmentIssue ? 'transaction-attachments-error' : undefined}
						{savedImages}
						onfileschange={onattachmentschange}
					/>
				{/key}
				{#if attachmentIssue}
					<p id="transaction-attachments-error" role="alert">{m['forms.validation_error']()}</p>
				{/if}
				<p>{m['images.formats']()} {m['images.max_count']()} {m['images.max_file_size']()}</p>
			{/if}
		{/snippet}
		{#snippet controls(form)}
			{#if mode === 'create' && oncancel}
				<Button type="button" onclick={oncancel}>{m['actions.cancel']()}</Button>
			{/if}
			{#if form.content.kind === 'success' && mode === 'create'}
				<Button type="reset"
					>{m['actions.add_another_subject']({
						subject: m['nouns.transaction']({ count: 1 })
					})}</Button
				>
			{:else if mode === 'create' || view.readiness.kind === 'ready'}
				<Button type="submit" variant="primary" disabled={!form.canSubmit}>
					{view.feedback.kind === 'result' &&
					view.feedback.result.outcome === 'failed' &&
					view.feedback.result.code === 'completionFailed'
						? m['actions.retry']()
						: m['actions.save_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
				</Button>
			{/if}
		{/snippet}
		{#snippet feedback(view)}
			<FormFeedback
				{view}
				subject={m['nouns.transaction']({ count: 1 })}
				reasonText={(reason) => formReasonText[reason]()}
				invalidMessage={m['forms.validation_error']()}
				section="result"
			/>
		{/snippet}
	</FormContent>
{/key}
