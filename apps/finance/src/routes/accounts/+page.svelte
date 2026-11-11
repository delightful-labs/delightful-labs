<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { inspectActor } from '#lib/diagnostics/inspector.js'
	import { observeRow, observeRows } from '#lib/runtime/observations.js'
	import {
		createAccountArchiveMachine,
		selectAccountArchiveView
	} from '#lib/machines/accounts/account-archive.js'
	import { stopAfterShutdown } from '#lib/runtime/actor-lifecycle.js'
	import { createActor } from 'xstate'
	import { archiveAccount } from '#lib/data.js'
	import { app } from '#lib/schema.js'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import {
		createQuerySubscription,
		createQuerySubscriptionOne
	} from 'delightful-local-first/backend/jazz/data'
	import { fromStore } from 'svelte/store'
	import { getContext, onMount } from 'svelte'
	import {
		accountBalancesKey,
		type AccountBalances,
		financeFiltersKey,
		type FinanceFilters
	} from '#lib/filters/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import {
		createAccountDeleteGrantMachine,
		selectAccountDeleteGrantView,
		type DeleteGrantObservation,
		type GrantWrite
	} from '#lib/machines/accounts/account-delete-grants.js'
	import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
	import AccountCreation from '#lib/components/accounts/AccountCreation.svelte'
	import AccountList from '#lib/components/accounts/AccountList.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const sharedBalances = getContext<AccountBalances>(accountBalancesKey)

	const db = getDb()
	const session = fromStore(getJazzSession())
	let accountActionsOpen = $state(false)
	const accounts = createQuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const membership = createQuerySubscriptionOne(() => {
		const organizationId = filters.activeOrganizationId
		const userId = session.current.account?.id
		return organizationMembershipQuery(organizationId, userId)
	})
	const grants = createQuerySubscription(() => {
		const organizationId = filters.activeOrganizationId
		const userId = session.current.account?.id
		return organizationId && userId
			? app.accountMemberships.where({ organizationId, userId })
			: undefined
	})
	const organizationMembers = createQuerySubscription(() =>
		accountActionsOpen && filters.activeOrganizationId
			? app.organizationMembers.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const allAccountGrants = createQuerySubscription(() =>
		accountActionsOpen && filters.activeOrganizationId
			? app.accountMemberships.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)

	function observe() {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready' && session.current.client?.db === db,
			loading: accounts.isLoading || membership.isLoading || grants.isLoading,
			failed: accounts.error != null || membership.error != null || grants.error != null,
			accounts: observeRows(accounts.current),
			membership: observeRow(membership.current),
			grants: observeRows(grants.current)
		}
	}
	function observeDeleteGrants(): DeleteGrantObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready' && session.current.client?.db === db,
			loading:
				accounts.isLoading ||
				membership.isLoading ||
				organizationMembers.isLoading ||
				allAccountGrants.isLoading,
			failed:
				accounts.error != null ||
				membership.error != null ||
				organizationMembers.error != null ||
				allAccountGrants.error != null,
			membership: observeRow(membership.current),
			accounts: observeRows(accounts.current),
			members: observeRows(organizationMembers.current),
			grants: observeRows(allAccountGrants.current)
		}
	}
	function persistDeleteGrant(write: GrantWrite) {
		return write.kind === 'update'
			? db.update(app.accountMemberships, write.grantId, { canDelete: write.canDelete }).wait({
					tier: 'local'
				})
			: db
					.insert(app.accountMemberships, {
						organizationId: write.organizationId,
						accountId: write.accountId,
						userId: write.userId,
						access: 'read',
						canDelete: write.canDelete
					})
					.wait({ tier: 'local' })
	}
	const actor = createActor(
		createAccountArchiveMachine((request) => archiveAccount(db, request.accountId), observe),
		{ inspect: inspectActor }
	)
	const deleteGrantActor = createActor(
		createAccountDeleteGrantMachine(persistDeleteGrant, observeDeleteGrants),
		{ inspect: inspectActor }
	)
	let archiveSnapshot = $state.raw(actor.getSnapshot())
	let deleteGrantSnapshot = $state.raw(deleteGrantActor.getSnapshot())
	const view = $derived(selectAccountArchiveView(archiveSnapshot))
	const deleteGrantView = $derived(selectAccountDeleteGrantView(deleteGrantSnapshot))
	const balances = $derived(sharedBalances.current)

	$effect(() => {
		actor.send({ type: 'OBSERVE', observation: observe() })
		deleteGrantActor.send({ type: 'OBSERVE', observation: observeDeleteGrants() })
	})
	onMount(() => {
		const subscription = actor.subscribe((snapshot) => {
			archiveSnapshot = snapshot
		})
		const deleteGrantSubscription = deleteGrantActor.subscribe((snapshot) => {
			deleteGrantSnapshot = snapshot
		})
		actor.start()
		deleteGrantActor.start()
		return () => {
			subscription.unsubscribe()
			deleteGrantSubscription.unsubscribe()
			// Keep issued local writes alive until shutdown settles.
			stopAfterShutdown(actor)
			stopAfterShutdown(deleteGrantActor)
		}
	})
	function onArchive(accountId: string) {
		// Refresh observations before accepting a request, including changes before effects run.
		actor.send({ type: 'OBSERVE', observation: observe() })
		actor.send({ type: 'ARCHIVE', accountId })
	}
	function onDeleteGrant(accountId: string, userId: string, canDelete: boolean) {
		deleteGrantActor.send({ type: 'OBSERVE', observation: observeDeleteGrants() })
		deleteGrantActor.send({ type: 'SET_DELETE', accountId, userId, canDelete })
	}
</script>

<svelte:head><title>{m['nouns.account']({ count: 2 })} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['nouns.account']({ count: 2 })} />{/snippet}

	<AccountCreation />
	<AccountList
		{view}
		{onArchive}
		{balances}
		onActionsOpenChange={(open) => (accountActionsOpen = open)}
		grantQueries={[organizationMembers, allAccountGrants]}
		deleteGrantView={{
			canManage:
				membership.current?.role === ORGANIZATION_ROLE.OWNER ||
				membership.current?.role === ORGANIZATION_ROLE.ADMIN,
			busy: deleteGrantView.busy,
			result: deleteGrantView.result,
			members: observeRows(organizationMembers.current).filter(
				(member) => member.role === ORGANIZATION_ROLE.MEMBER
			),
			grants: observeRows(allAccountGrants.current)
		}}
		{onDeleteGrant}
	/>
</PageLayout>
