<script lang="ts">
	import { observeRow, observeRows } from '#lib/runtime/observations.js'
	import { createScopedFormController } from '#lib/forms/forms.svelte.js'
	import {
		createInternalTransferEntryFormOptions,
		selectInternalTransferEntryAccounts
	} from '#lib/machines/transfers/internal-transfer-entry.js'
	import type { InternalTransferEntryObservation } from '#lib/contracts/transfer-create-contract.js'
	import { app } from '#lib/schema.js'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import {
		createQuerySubscription,
		createQuerySubscriptionOne
	} from 'delightful-local-first/backend/jazz/data'
	import { fromStore } from 'svelte/store'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/filters/finance-filters.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import { readinessKey, type ReadinessContext } from '#lib/runtime/bank-sync.js'
	import { captureTransferMutationScope } from '#lib/machines/runtime/application-readiness.js'
	import PairedTransferForm from './PairedTransferForm.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const readiness = getContext<ReadinessContext>(readinessKey)
	const db = getDb()
	const session = fromStore(getJazzSession())
	const accounts = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const categories = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({
					organizationId: filters.activeOrganizationId,
					archivedAt: { isNull: true }
				})
			: undefined
	)
	const membership = createQuerySubscriptionOne(() =>
		organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
	)
	const grants = createQuerySubscription(() =>
		filters.activeOrganizationId && session.current.account?.id
			? app.accountMemberships.where({
					organizationId: filters.activeOrganizationId,
					userId: session.current.account.id
				})
			: undefined
	)
	function observe(): InternalTransferEntryObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready' && session.current.client?.db === db,
			loading: [accounts, categories, membership, grants].some((query) => query.isLoading),
			failed: [accounts, categories, membership, grants].some((query) => query.error != null),
			accounts: observeRows(accounts.current),
			categories: observeRows(categories.current),
			membership: observeRow(membership.current),
			grants: observeRows(grants.current)
		}
	}
	const form = createScopedFormController(
		createInternalTransferEntryFormOptions({
			db,
			observe,
			trackWrite: (write) => readiness.actor.send({ type: 'TRANSFER_WRITE_TRACKED', write }),
			mutationGateway: {
				captureScope: (request) =>
					captureTransferMutationScope(readiness.actor.getSnapshot(), request),
				send: (event) => readiness.actor.send(event)
			}
		})
	)
	const writableAccounts = $derived(selectInternalTransferEntryAccounts(observe()))
</script>

<PairedTransferForm
	accounts={writableAccounts}
	view={form.view}
	onsubmit={form.submit}
	onreset={form.reset}
	oninput={form.input}
/>
