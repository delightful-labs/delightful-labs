<script lang="ts">
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()
	import { transactionKindForPath, transactionPages } from '#lib/domain/transaction-kind.js'
	import { m } from '#lib/paraglide/messages.js'
	import type { Snippet } from 'svelte'
	import { onNavigate } from '$app/navigation'
	import { page } from '$app/state'
	import TransactionWorkspace from '#lib/components/transactions/TransactionWorkspace.svelte'
	import TransactionView from '#lib/components/transactions/TransactionView.svelte'

	let { children }: { children: Snippet } = $props()
	const pathname = $derived(page.url.pathname)
	const kind = $derived(transactionKindForPath(pathname))
	const config = $derived(transactionPages[kind])
	const heading = $derived(m[config.noun]({ count: config.count }))
	const index = $derived(pathname === config.path)
	const listHref = $derived(page.params.id ? `${config.path}${page.url.search}` : undefined)

	onNavigate((navigation) => {
		if (!navigation.to?.route.id?.startsWith('/(transactions)/')) return
		if (navigation.from?.url.pathname === navigation.to.url.pathname) return
		if (!document.startViewTransition) return
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

		return new Promise<void>((resolve) => {
			const transition = document.startViewTransition(async () => {
				// Let SvelteKit update the page after the browser captures the old view.
				resolve()
				await navigation.complete
			})
			// A skipped or failed capture must never hold up navigation.
			void transition.updateCallbackDone.catch(() => resolve())
		})
	})
</script>

<TransactionWorkspace
	{navigation}
	{children}
	{index}
	{heading}
	drawerHeading={m['nouns.transaction']({ count: 2 })}
	{listHref}
>
	{#snippet list(showHeading, navigation, closeControl)}
		<TransactionView
			{navigation}
			{kind}
			{heading}
			listPath={config.path}
			{showHeading}
			{closeControl}
		/>
	{/snippet}
</TransactionWorkspace>

<style>
	:global {
		::view-transition-old(root),
		::view-transition-new(root) {
			animation: none;
			mix-blend-mode: normal;
		}

		::view-transition-group(transaction-content) {
			animation: none;
		}

		::view-transition-old(transaction-content) {
			display: none;
		}

		::view-transition-new(transaction-content) {
			animation: transaction-slide-in 300ms ease-out both;
			mix-blend-mode: normal;
		}

		@media (prefers-reduced-motion: reduce) {
			::view-transition-new(transaction-content) {
				animation: none;
			}
		}
	}

	@keyframes -global-transaction-slide-in {
		from {
			transform: translateX(-100vw);
		}
		to {
			transform: translateX(0);
		}
	}
</style>
