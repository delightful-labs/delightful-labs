<script lang="ts">
	import { observeRow, observeRows } from '#lib/runtime/observations.js'
	import { getContext, type Snippet } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import {
		createQuerySubscription,
		createQuerySubscriptionOne
	} from 'delightful-local-first/backend/jazz/data'
	import type { AccountCreationObservation } from '#lib/contracts/account-creation-contract.js'
	import { createScopedFormController } from '#lib/forms/forms.svelte.js'
	import { createAccountCreationFormOptions } from '#lib/machines/accounts/account-creation-access.js'
	import { app } from '#lib/schema.js'
	import { createAccount } from '#lib/data.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/filters/finance-filters.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import AccountForm from './AccountForm.svelte'

	let { trigger }: { trigger?: Snippet<[() => void, boolean]> | undefined } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const db = getDb()
	const session = fromStore(getJazzSession())
	const identityId = $derived(session.current.account?.id ?? null)
	const organizationId = $derived(filters.activeOrganizationId)
	const binding = $derived(session.current.client?.db ?? null)
	const scope = $derived({ identityId, organizationId, binding })
	const membership = createQuerySubscriptionOne(() =>
		organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
	)
	const workspace = createQuerySubscriptionOne(() =>
		filters.activeOrganizationId
			? app.organizations.where({ id: filters.activeOrganizationId })
			: undefined
	)
	const accounts = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	function observe(): AccountCreationObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			membership: observeRow(membership.current),
			accounts: observeRows(accounts.current),
			loading: membership.isLoading || workspace.isLoading || accounts.isLoading,
			error: membership.error ?? workspace.error ?? accounts.error
		}
	}
	const defaultCurrency = $derived(workspace.current?.defaultCurrency === 'TZS' ? 'TZS' : 'USD')
	const options = createAccountCreationFormOptions({
		binding: db,
		observe,
		create: (id, values) => createAccount(db, id, values.name, values.kind, values.currency)
	})
	const form = createScopedFormController(options)
</script>

<AccountForm
	{scope}
	{defaultCurrency}
	{trigger}
	view={form.view}
	onopen={form.open}
	onsubmit={form.submit}
	onreset={form.reset}
	onRetryReadiness={form.retryReadiness}
/>
