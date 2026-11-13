<script lang="ts">
	import { onMount, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import {
		Button,
		Drawer,
		Heading,
		Icon,
		Navigation,
		NavigationLink,
		StatusMessage
	} from 'delightful-ui'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'
	import MenuIcon from 'tdesign-icons-svg/src/menu.svg?component'
	import { getAccountSettings } from '../runtime/account-settings.js'
	import { action, noun, t } from '../localization/index.js'
	import ConnectionStatus from './ConnectionStatus.svelte'

	let {
		children,
		focused = false,
		showControl = true
	}: {
		children: Snippet<[accountControl: Snippet]>
		focused?: boolean
		showControl?: boolean
	} = $props()
	const settings = getAccountSettings()
	let drawer: ReturnType<typeof Drawer> | undefined = $state()
	let trigger: ReturnType<typeof Button> | undefined = $state()
	let mobile = $state(false)
	const drawerOpen = $derived(drawer?.isOpen() ?? false)
	const modal = $derived(mobile && drawerOpen && !focused)

	onMount(() => {
		const viewport = window.matchMedia('(max-width: 48rem)')
		const resize = () => {
			mobile = viewport.matches
			if (mobile) drawer?.close()
			else if (!drawer?.isOpen()) drawer?.toggle()
		}
		resize()
		viewport.addEventListener('change', resize)
		return () => viewport.removeEventListener('change', resize)
	})
</script>

{#snippet accountControl()}
	{#if !focused}
		<Button
			bind:this={trigger}
			type="button"
			aria-label={drawerOpen ? action('close', 'account') : action('show', 'account')}
			aria-controls={drawer?.getId()}
			aria-expanded={drawerOpen}
			onclick={() => drawer?.toggle()}
		>
			<Icon icon={drawerOpen ? CloseIcon : MenuIcon} width="24" height="24" />
		</Button>
	{/if}
{/snippet}

<div class="account-layout">
	{#if showControl && !focused}
		<div class="account-control">{@render accountControl()}</div>
	{/if}
	<div class="account-workspace">
		<Drawer
			bind:this={drawer}
			hidden={focused}
			class="account-drawer"
			heading={noun('account')}
			headingHidden
			showCloseButton={false}
			closeLabel={action('close', 'account')}
			onopenchange={(open) => {
				if (!open) trigger?.focus({ preventScroll: true })
			}}
		>
			<div class="sidebar-content">
				<div class="drawer-brand">
					<Heading level="h2" size="lg"><a href="/">{t('app.title')}</a></Heading>
				</div>
				<Navigation label={t('library.heading')}>
					<li>
						<NavigationLink
							href="/"
							aria-current={page.url.pathname === '/' ? 'page' : undefined}
							onclick={() => {
								if (mobile) drawer?.close()
							}}>{t('library.all_articles')}</NavigationLink
						>
					</li>
					<li>
						<NavigationLink
							href="/account"
							aria-current={page.url.pathname === '/account' ? 'page' : undefined}
							onclick={() => {
								if (mobile) drawer?.close()
							}}>{noun('account')}</NavigationLink
						>
					</li>
				</Navigation>
				<div class="account-panel">
					{#if settings.accountMessage?.text}<StatusMessage {...settings.accountMessage} />{/if}
					<ConnectionStatus message={settings.connectionMessage} />
				</div>
			</div>
		</Drawer>
		<div class="account-content" inert={modal}>
			{@render children(accountControl)}
		</div>
		{#if modal}
			<button
				class="drawer-dismiss"
				type="button"
				aria-label={action('close', 'account')}
				onclick={() => drawer?.close()}
			></button>
		{/if}
	</div>
</div>

<style>
	.account-layout {
		--dui-drawer-width: 20rem;
		--dui-drawer-panel-border-inline-end: var(
				--dui-dialog-border-width,
				var(--dui-border-width, 2px)
			)
			solid var(--dui-dialog-border-color, var(--dui-color-foreground, currentColor));
	}

	.account-workspace {
		position: relative;
		display: flex;
		min-inline-size: 0;
	}
	.account-control {
		display: flex;
	}
	.sidebar-content {
		display: grid;
		gap: var(--dui-space-md);
	}
	.account-panel {
		margin-block-start: auto;
	}
	.account-content {
		flex: 1 1 0%;
		min-inline-size: 0;
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
		z-index: 2;
	}
	@media (max-width: 48rem) {
		.account-layout {
			--dui-drawer-width: calc(100vw - 3.5rem);
		}

		.account-workspace {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
		}
		.account-workspace :global(.account-drawer) {
			z-index: 1;
		}

		.account-workspace :global(.account-drawer),
		.account-content {
			grid-area: 1 / 1;
		}
	}
</style>
