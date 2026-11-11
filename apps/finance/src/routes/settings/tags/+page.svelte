<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { observeRow, observeRows } from '#lib/runtime/observations.js'
	import { createScopedFormController } from '#lib/forms/forms.svelte.js'
	import { tagArchiveSchema, tagFormSchema } from '#lib/validation/tags.js'
	import {
		createManagementFormOptions,
		selectManagementArchiveIds
	} from '#lib/machines/management/management.js'
	import type { ManagementObservation } from '#lib/contracts/management-contract.js'
	import { archiveTag, createTag } from '#lib/data.js'
	import { app } from '#lib/schema.js'
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
	import TagForm from '#lib/components/classification/TagForm.svelte'
	import TagList from '#lib/components/classification/TagList.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import QueryContent from '#lib/components/shared/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const db = getDb()
	const tags = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags.where({ organizationId: filters.activeOrganizationId }).orderBy('name')
			: undefined
	)
	// Archived categories retain their labels in tag history.
	const categories = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const categoryNames = $derived(
		new Map((categories.current ?? []).map((category) => [category.id, category.name]))
	)
	const session = fromStore(getJazzSession())
	const membership = createQuerySubscriptionOne(() => {
		const userId = session.current.account?.id
		const organizationId = filters.activeOrganizationId
		return organizationMembershipQuery(organizationId, userId)
	})
	const availableCategories = $derived(
		(categories.current ?? [])
			.filter((c) => c.organizationId === filters.activeOrganizationId && !c.archivedAt)
			.toSorted((a, b) => a.name.localeCompare(b.name))
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
			loading: [membership, categories, tags].some((q) => q.isLoading),
			failed: [membership, categories, tags].some((q) => q.error != null),
			categories: observeRows(categories.current),
			tags: observeRows(tags.current)
		}
	}
	const formOptions = createManagementFormOptions({ binding: db, observe })

	const options = formOptions({
		schema: tagFormSchema,
		successContent: 'replace',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: {
				kind: 'createTag',
				name: request.values.name,
				tagKind: request.values.kind,
				categoryId: request.values.categoryId
			}
		}),
		write: async ({ request }) => {
			const id = request.scope.organizationId
			if (id === null) throw new Error('Missing authorized workspace')
			return createTag(db, id, request.values.name, request.values.kind, request.values.categoryId)
		}
	})
	const form = createScopedFormController(options)
	const archiveOptions = formOptions({
		schema: tagArchiveSchema,
		successContent: 'retain',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: {
				kind: 'archiveTag',
				id: request.values.tagId,
				organizationId: request.values.organizationId
			}
		}),
		write: async ({ request, observation }) => {
			const row = observation.facts.tags.find((row) => row.id === request.values.tagId)
			if (!row) throw new Error('Missing authorized record')
			await archiveTag(db, row.id)
			return row.name
		}
	})
	const archive = createScopedFormController(archiveOptions)
	const archivableIds = $derived(selectManagementArchiveIds(observe(), db, 'archiveTag'))
	function onArchive(id: string) {
		archive.submitValues({ tagId: id, organizationId: filters.activeOrganizationId })
	}
</script>

<svelte:head>
	<title>{m['nouns.tag']({ count: 2 })} · {m['app.name']()}</title>
</svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['nouns.tag']({ count: 2 })} />{/snippet}

	<QueryContent
		queries={[membership, tags, categories]}
		loadingMessage={m['status.loading_subject']({ subject: m['nouns.tag']({ count: 2 }) })}
		errorMessage={m['errors.load_subject']({ subject: m['nouns.tag']({ count: 2 }) })}
	>
		{#if filters.activeOrganizationId && membership.current}
			<TagList
				tags={tags.current ?? []}
				{categoryNames}
				archivableTagIds={archivableIds}
				archiveView={archive.view}
				{onArchive}
			/>
		{/if}
	</QueryContent>

	<TagForm
		{scope}
		view={form.view}
		onopen={form.open}
		onsubmit={form.submit}
		onreset={form.reset}
		onRetryReadiness={form.retryReadiness}
		categories={availableCategories}
	/>
</PageLayout>
