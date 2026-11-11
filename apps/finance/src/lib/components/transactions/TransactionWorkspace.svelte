<script lang="ts">
	import NavigationSpacer from '../navigation/NavigationSpacer.svelte'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import PageHeader from '../navigation/PageHeader.svelte'
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import { Button, Drawer, ScreenReaderText } from 'delightful-ui'
	import { onMount, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import { isMobile } from '#lib/runtime/viewport.js'
	import { m } from '#lib/paraglide/messages.js'
	import Icon from '../navigation/AppIcon.svelte'
	import ListIcon from 'tdesign-icons-svg/src/view-list.svg?component'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'

	let {
		navigation,
		children,
		list,
		index,
		heading,
		drawerHeading = heading,
		listHref
	}: {
		navigation: Snippet
		children: Snippet
		list: Snippet<[boolean, Snippet, Snippet?]>
		index: boolean
		heading: string
		drawerHeading?: string
		listHref?: string | undefined
	} = $props()
	let workspaceElement = $state<HTMLDivElement>()
	let scrollbarInset = $state(0)
	let desktop = $state(false)
	let drawerOpen = $state(true)
	const drawerId = $props.id()
	onMount(() => {
		desktop = !isMobile()
	})

	$effect(() => {
		if (!desktop || !workspaceElement || !page.url.pathname) return
		const scrollport = workspaceElement.querySelector<HTMLElement>(
			drawerOpen ? '.transaction-list .page-layout' : '.transaction-page .page-layout'
		)
		if (!scrollport) return
		function alignControl() {
			if (scrollport) scrollbarInset = scrollport.offsetWidth - scrollport.clientWidth
		}
		// The spacer is inside the scrollport; align the persistent button to that same edge.
		alignControl()
		const observer = new ResizeObserver(alignControl)
		observer.observe(scrollport)
		return () => observer.disconnect()
	})
</script>

{#snippet emptyNavigation()}{/snippet}

<svelte:window onresize={() => (desktop = !isMobile())} />

{#snippet closeSpacer()}
	<NavigationSpacer />
{/snippet}

<div
	class="transaction-workspace"
	bind:this={workspaceElement}
	data-desktop={desktop}
	data-drawer-open={drawerOpen}
>
	<div class="transaction-panels">
		<div class="transaction-content" hidden={!desktop && index}>
			<div class="transaction-page">
				{#if desktop && index}
					<PageLayout {navigation}>
						{#snippet pageHeading()}<PageHeader title={heading} />{/snippet}
					</PageLayout>
				{/if}
				{#if !desktop && listHref}
					<AppLink href={listHref}
						>{m['actions.back_to_subject']({ subject: m['nouns.list']({ count: 1 }) })}</AppLink
					>
				{/if}
				{@render children()}
			</div>
		</div>
		{#if desktop}
			<Drawer
				id={drawerId}
				side="right"
				heading={drawerHeading}
				headingHidden
				showCloseButton={false}
				closeLabel={m['actions.close_subject']({
					subject: m['nouns.transaction']({ count: 2 })
				})}
				bind:open={drawerOpen}
			>
				<div class="transaction-list">
					{@render list(false, emptyNavigation, closeSpacer)}
				</div>
			</Drawer>
		{:else if index}
			<div class="transaction-mobile-list">
				{@render list(true, navigation)}
			</div>
		{/if}
	</div>
	{#if desktop}
		<div class="drawer-toggle" style:margin-inline-end={`${scrollbarInset}px`}>
			<Button
				class="transaction-drawer-toggle"
				type="button"
				aria-controls={drawerId}
				aria-expanded={drawerOpen}
				onclick={() => (drawerOpen = !drawerOpen)}
			>
				<Icon icon={drawerOpen ? CloseIcon : ListIcon} />
				<ScreenReaderText
					>{drawerOpen
						? m['actions.close_subject']({ subject: m['nouns.transaction']({ count: 2 }) })
						: m['actions.open_subject']({
								subject: m['nouns.transaction']({ count: 2 })
							})}</ScreenReaderText
				>
			</Button>
		</div>
	{/if}
</div>

<style>
	.transaction-workspace {
		--dui-drawer-width: clamp(18rem, 35vw, 30rem);
		--dui-drawer-padding: 0 0 0 1rem;
		--transaction-control-spacer: calc(var(--dui-button-min-height, 44px) + var(--dui-spacing-xs));
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
		height: 100%;
	}

	.transaction-workspace[data-desktop='true'] {
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		grid-template-columns: minmax(0, 1fr);
	}

	.transaction-panels {
		grid-area: 1 / 1;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
		height: 100%;
	}

	.transaction-workspace[data-desktop='true'] .transaction-panels {
		display: flex;
		align-items: flex-start;
	}

	.transaction-content {
		view-transition-name: transaction-content;
		min-block-size: 0;
		height: 100%;
		overflow: hidden;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		align-content: start;
		grid-template-columns: minmax(0, 1fr);
		min-inline-size: 0;
		flex: 1 1 0%;
	}

	.transaction-mobile-list {
		min-block-size: 0;
		height: 100%;
		overflow: hidden;
		view-transition-name: transaction-content;
	}

	.transaction-list {
		min-block-size: 0;
		height: 100%;
		overflow: hidden;
	}

	.transaction-workspace :global(.page-layout) {
		scrollbar-gutter: stable;
	}

	.transaction-workspace :global(.transaction-drawer-toggle) {
		--dui-button-padding: var(--dui-spacing-xs, 0.5rem);
		inline-size: var(--dui-button-min-height, 44px);
		block-size: var(--dui-button-min-height, 44px);
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.transaction-page {
		grid-area: 1 / 1;
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
	}

	.transaction-page :global(.page-layout) {
		flex: 1 1 0%;
	}

	.transaction-workspace[data-drawer-open='true'] {
		--transaction-control-spacer: 0px;
	}

	.transaction-workspace[data-desktop='true'] .transaction-page :global(.page-heading) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
	}

	.transaction-workspace[data-desktop='true'] .transaction-page :global(.page-heading)::after {
		content: '';
		inline-size: var(--transaction-control-spacer);
		block-size: var(--dui-button-min-height, 44px);
		transition: inline-size var(--dui-drawer-duration, 225ms);
	}

	.drawer-toggle {
		grid-area: 1 / 1;
		align-self: start;
		justify-self: end;
		position: sticky;
		inset-block-start: 0;
		z-index: 2;
	}

	@media (prefers-reduced-motion: reduce) {
		.transaction-page :global(.page-heading)::after {
			transition: none;
		}
	}

	[hidden] {
		display: none;
	}
</style>
