<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { classificationCounts } from '#lib/domain/classification-counts.js'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { observeRow, observeRows } from '#lib/runtime/observations.js'
	import { createScopedFormController } from '#lib/forms/forms.svelte.js'
	import { selectManagementArchiveIds } from '#lib/machines/management/management.js'
	import type { ManagementObservation } from '#lib/contracts/management-contract.js'
	import { createCategoryManagementFormOptions } from '#lib/machines/management/classification-forms.js'
	import { archiveCategory, createCategory } from '#lib/data.js'
	import { app, transactionSummaryQuery } from '#lib/schema.js'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import {
		createQuerySubscription,
		createQuerySubscriptionOne
	} from 'delightful-local-first/backend/jazz/data'
	import { fromStore } from 'svelte/store'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/filters/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import CategoryForm from '#lib/components/classification/CategoryForm.svelte'
	import CategoryList from '#lib/components/classification/CategoryList.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import QueryContent from '#lib/components/shared/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const db = getDb()
	const session = fromStore(getJazzSession())
	const categories = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({ organizationId: filters.activeOrganizationId }).orderBy('name')
			: undefined
	)
	// Count all readable history, regardless of sidebar account selection or tag archive state.
	const transactions = createQuerySubscription(() =>
		filters.activeOrganizationId
			? transactionSummaryQuery.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const tags = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const membership = createQuerySubscriptionOne(() => {
		const organizationId = filters.activeOrganizationId
		const userId = session.current.account?.id
		return organizationMembershipQuery(organizationId, userId)
	})
	const counts = $derived(
		classificationCounts(categories.current ?? [], transactions.current ?? [], tags.current ?? [])
	)

	const identityId = $derived(session.current.account?.id ?? null)
	const organizationId = $derived(filters.activeOrganizationId)
	const binding = $derived(session.current.client?.db ?? null)
	const scope = $derived({ identityId, organizationId, binding })
	function observe(): ManagementObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			membership: observeRow(membership.current),
			loading: [membership, categories, tags, transactions].some((q) => q.isLoading),
			failed: [membership, categories, tags, transactions].some((q) => q.error != null),
			categories: observeRows(categories.current),
			tags: observeRows(tags.current)
		}
	}
	const options = createCategoryManagementFormOptions({
		binding: db,
		observe,
		create: (id, values) => createCategory(db, id, values.name, values.kind),
		archive: (id) => archiveCategory(db, id)
	})
	const form = createScopedFormController(options.create)
	const archive = createScopedFormController(options.archive)
	const archivableIds = $derived(selectManagementArchiveIds(observe(), db, 'archiveCategory'))
	function onArchive(id: string) {
		archive.submitValues({ categoryId: id, organizationId: filters.activeOrganizationId })
	}
</script>

<svelte:head><title>{m['nouns.category']({ count: 2 })} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['nouns.category']({ count: 2 })} />{/snippet}

	<QueryContent
		keepContentWhileLoading
		queries={[categories, transactions, tags, membership]}
		loadingMessage={m['status.loading_subject']({ subject: m['nouns.category']({ count: 2 }) })}
		errorMessage={m['errors.load_subject']({ subject: m['nouns.category']({ count: 2 }) })}
	>
		{#if filters.activeOrganizationId && (membership.current || membership.isLoading)}
			<CategoryList
				loading={categories.isLoading}
				categories={categories.current ?? []}
				{counts}
				archivableCategoryIds={archivableIds}
				archiveView={archive.view}
				{onArchive}
			/>
		{/if}

		<CategoryForm
			{scope}
			view={form.view}
			onopen={form.open}
			onsubmit={form.submit}
			onreset={form.reset}
			onRetryReadiness={form.retryReadiness}
		/>
	</QueryContent>
</PageLayout>
