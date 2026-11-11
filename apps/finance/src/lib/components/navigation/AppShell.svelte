<script lang="ts">
	import NavigationSpacer from './NavigationSpacer.svelte'
	import { setPageNavigation } from './page-navigation.js'
	import AppTopMenu from './AppTopMenu.svelte'
	import AppDrawer from './AppDrawer.svelte'
	import AppDrawerNavigation from './AppDrawerNavigation.svelte'
	import AppDrawerAccounts from './AppDrawerAccounts.svelte'
	import AppDrawerSettings from './AppDrawerSettings.svelte'
	import AppDrawerStatus from './AppDrawerStatus.svelte'
	import type QueryContent from '../shared/QueryContent.svelte'
	import { onMount, type ComponentProps, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import { isMobile } from '#lib/runtime/viewport.js'
	import type { BankSyncControls } from '#lib/runtime/bank-sync.js'
	import type { Account, Organization } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		children,
		accountCreation,
		bankSync,
		syncConfigured,
		browserOffline,
		organizations,
		accounts,
		accountBalances = null,
		organizationId,
		selectedAccountIds,
		organizationQueries,
		accountQueries,
		onOrganizationChange,
		onAccountChange,
		onAllAccountsChange,
		editingAccountOrder,
		canToggleAccountOrder,
		canMoveAccount,
		onEditAccountOrder,
		onDoneAccountOrder,
		onMoveAccount
	}: {
		children: Snippet
		accountCreation: Snippet<[Snippet<[() => void, boolean]>]>
		bankSync: BankSyncControls
		syncConfigured: boolean
		browserOffline: boolean
		organizations: readonly Organization[] | undefined
		accountBalances?: ReadonlyMap<string, bigint> | null
		accounts: readonly Account[]
		organizationId: string | null
		selectedAccountIds: readonly string[] | null
		organizationQueries: ComponentProps<typeof QueryContent>['queries']
		accountQueries: ComponentProps<typeof QueryContent>['queries']
		onOrganizationChange: (value: string) => void
		onAccountChange: (accountId: string, checked: boolean) => void
		onAllAccountsChange: (checked: boolean) => void
		editingAccountOrder: boolean
		canToggleAccountOrder: boolean
		canMoveAccount: (id: string, direction: 'up' | 'down') => boolean
		onEditAccountOrder: () => void
		onDoneAccountOrder: () => void
		onMoveAccount: (id: string, direction: 'up' | 'down') => void
	} = $props()
	const shellId = $props.id()
	const drawerId = `${shellId}-navigation`
	const toggleId = `${shellId}-toggle`
	let drawerOpen = $state(false)
	let mobileViewport = $state(false)
	setPageNavigation(navigationSpacer)
	const mainInert = $derived(mobileViewport && drawerOpen)

	onMount(() => {
		mobileViewport = isMobile()
		drawerOpen = !mobileViewport
	})

	function toggleDrawer() {
		drawerOpen = !drawerOpen
	}

	function dismissMobileDrawer() {
		if (isMobile()) drawerOpen = false
	}
</script>

<svelte:window onresize={() => (mobileViewport = isMobile())} />

{#snippet navigationSpacer()}
	<NavigationSpacer collapsed={drawerOpen} gap="var(--dui-spacing-md)" />
{/snippet}

<div class="app-shell">
	<div class="navigation-control">
		<AppTopMenu {drawerId} {toggleId} {drawerOpen} onToggle={toggleDrawer} />
	</div>
	<div class="workspace" data-drawer-open={drawerOpen}>
		<AppDrawer {drawerId} bind:drawerOpen>
			<AppDrawerNavigation pathname={page.url.pathname} onNavigate={dismissMobileDrawer}>
				<AppDrawerAccounts
					pathname={page.url.pathname}
					onNavigate={dismissMobileDrawer}
					{accountCreation}
					{accounts}
					{accountBalances}
					{selectedAccountIds}
					{accountQueries}
					{onAccountChange}
					{onAllAccountsChange}
					{editingAccountOrder}
					{canToggleAccountOrder}
					{canMoveAccount}
					{onEditAccountOrder}
					{onDoneAccountOrder}
					{onMoveAccount}
				/>
				<AppDrawerSettings
					pathname={page.url.pathname}
					onNavigate={dismissMobileDrawer}
					{organizations}
					{organizationId}
					{organizationQueries}
					{onOrganizationChange}
				/>
			</AppDrawerNavigation>
			{#snippet footer()}
				<AppDrawerStatus {bankSync} {browserOffline} {syncConfigured} />
			{/snippet}
		</AppDrawer>
		<div class="content" inert={mainInert}>
			{@render children()}
		</div>
		{#if mainInert}
			<button
				class="drawer-dismiss"
				type="button"
				aria-label={m['actions.close_subject']({ subject: m['navigation.label']() })}
				onclick={() => {
					drawerOpen = false
					document.getElementById(toggleId)?.focus()
				}}
			></button>
		{/if}
	</div>
</div>

<style>
	.app-shell {
		--app-navigation-size: 2.75rem;
		--app-page-padding: var(--dui-space-sm, 1rem);
		--dui-drawer-height: 100%;
		--dui-details-content-border-width: 0;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		min-block-size: 0;
		max-block-size: 100dvh;
		height: 100dvh;
		overflow: hidden;
	}

	.navigation-control {
		grid-area: 1 / 1;
		align-self: start;
		justify-self: start;
		position: sticky;
		inset-block-start: var(--app-page-padding);
		margin: var(--app-page-padding);
		z-index: 3;
	}

	.workspace {
		grid-area: 1 / 1;
		display: flex;
		align-items: flex-start;
		min-block-size: 0;
		overflow: hidden;
	}

	.content {
		min-block-size: 0;
		flex: 1 1 0%;
		min-width: 0;
		padding: var(--app-page-padding);
		box-sizing: border-box;
		overflow: auto;
		height: 100%;
	}

	.content:has(:global(.transaction-workspace)) {
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		overflow: hidden;
	}

	.drawer-dismiss {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		inline-size: 3.5rem;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}

	@media (max-width: 48rem) {
		.app-shell {
			inline-size: 100%;
			min-inline-size: 0;
			overflow-x: clip;
		}

		.workspace {
			position: relative;
			gap: 0;
			inline-size: 100%;
			min-inline-size: 0;
			overflow-x: clip;
		}

		.content {
			box-sizing: border-box;
			flex: 0 0 100%;
		}
	}
</style>
