<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { transactionPages, type TransactionKind } from '#lib/domain/transaction-kind.js'
	import { workspaceHref } from '#lib/domain/workspace-routes.js'
	import { goto } from '$app/navigation'
	import { observeRow, observeRows } from '#lib/runtime/observations.js'
	import { orderAccounts } from '#lib/machines/accounts/account-order.js'
	import { createScopedFormController } from '#lib/forms/forms.svelte.js'
	import { app } from '#lib/schema.js'
	import { defaultTransactionCategory } from '#lib/validation/transactions.js'
	import {
		createTransactionEntryFormOptions,
		writableTransactionAccounts,
		applicableTransactionCategories,
		applicableTransactionTags
	} from '#lib/machines/transactions/transaction-entry.js'
	import type { TransactionEntryObservation } from '#lib/contracts/transaction-entry-contract.js'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import { fromStore } from 'svelte/store'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import {
		createQuerySubscription,
		createQuerySubscriptionOne
	} from 'delightful-local-first/backend/jazz/data'
	import { getContext } from 'svelte'
	import {
		financeFiltersKey,
		accountOrderKey,
		type FinanceFilters,
		type AccountOrder
	} from '#lib/filters/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountCreation from '#lib/components/accounts/AccountCreation.svelte'
	import TransactionForm from '#lib/components/transactions/TransactionForm.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	let { kind }: { kind: TransactionKind } = $props()
	let selectedAttachments = $state<readonly File[]>([])
	let attachmentPickerRevision = $state(0)
	const config = $derived(transactionPages[kind])
	const subject = $derived(m[config.noun]({ count: config.count }))
	const title = $derived(m['actions.add_subject']({ subject }))
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const accountOrder = getContext<AccountOrder>(accountOrderKey)

	const db = getDb()
	const tagQuery = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const tagSuggestions = $derived(applicableTransactionTags(observe()).map((tag) => tag.name))
	const accountQuery = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const categoryQuery = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories
					.where({
						organizationId: filters.activeOrganizationId,
						kind,
						archivedAt: { isNull: true }
					})
					.orderBy('name')
			: undefined
	)

	const session = fromStore(getJazzSession())
	const membership = createQuerySubscriptionOne(() =>
		organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
	)
	const grantQuery = createQuerySubscription(() =>
		filters.activeOrganizationId && session.current.account?.id
			? app.accountMemberships.where({
					organizationId: filters.activeOrganizationId,
					userId: session.current.account.id
				})
			: undefined
	)
	function observe(): TransactionEntryObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			kind,
			membership: observeRow(membership.current),
			grants: observeRows(grantQuery.current),
			accounts: observeRows(accountQuery.current),
			categories: observeRows(categoryQuery.current),
			tags: observeRows(tagQuery.current),
			loading: [membership, grantQuery, accountQuery, categoryQuery, tagQuery].some(
				(q) => q.isLoading
			),
			failed: [membership, grantQuery, accountQuery, categoryQuery, tagQuery].some(
				(q) => q.error != null
			)
		}
	}
	const accounts = $derived(orderAccounts(writableTransactionAccounts(observe()), accountOrder.ids))
	const defaultAccountId = $derived(
		accounts.find(
			(account) =>
				filters.selectedAccountIds === null || filters.selectedAccountIds.includes(account.id)
		)?.id
	)
	const availableCategories = $derived(applicableTransactionCategories(observe()))
	const defaultCategory = $derived(
		defaultTransactionCategory({
			organizationId: filters.activeOrganizationId,
			kind,
			categories: availableCategories
		})
	)
	const options = createTransactionEntryFormOptions({
		binding: db,
		observe,
		getAttachments: () => selectedAttachments,
		navigate: (destination, signal) => {
			signal.throwIfAborted()
			return goto(destination, { replace: true })
		},
		db
	})
	const form = createScopedFormController({
		...options,
		arrayFields: () => ['tags', 'attachments']
	})
	function updateAttachments(files: readonly File[]) {
		selectedAttachments = files
	}
	let observedDraftRevision = form.view.draftRevision
	$effect(() => {
		const revision = form.view.draftRevision
		if (revision !== observedDraftRevision) {
			observedDraftRevision = revision
			selectedAttachments = []
			attachmentPickerRevision += 1
		}
		const feedback = form.view.feedback
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
</script>

<svelte:head><title>{title} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader {title} />{/snippet}

	<FormFeedback
		view={form.view}
		subject={m['nouns.transaction']({ count: 1 })}
		reasonText={(reason) => formReasonText[reason]()}
		invalidMessage={m['forms.validation_error']()}
		section={form.view.readiness.kind === 'ready' ? 'readiness' : 'all'}
		onRetryReadiness={form.retryReadiness}
	/>
	{#if form.view.readiness.kind === 'blocked' && form.view.readiness.reason === 'noAccounts'}
		<AccountCreation />
	{:else if form.view.readiness.kind === 'ready'}
		<TransactionForm
			{kind}
			paymentEntry={config.paymentEntry}
			organizationId={filters.activeOrganizationId}
			{accounts}
			onattachmentschange={updateAttachments}
			{attachmentPickerRevision}
			{defaultAccountId}
			categories={availableCategories}
			defaultCategoryId={defaultCategory?.id}
			{tagSuggestions}
			view={form.view}
			onsubmit={form.submit}
			onreset={form.reset}
			oncancel={() => goto(workspaceHref(filters.activeOrganizationId, config.path))}
		/>
	{/if}
</PageLayout>
