<script lang="ts">
	import 'delightful-ui/theme.css'
	import {
		PUBLIC_JAZZ_APP_ID,
		PUBLIC_JAZZ_SERVER_URL,
		PUBLIC_SIMPLEFIN_DEMO
	} from '$app/env/public'
	import { onMount, type Snippet } from 'svelte'
	import { fromStore, readable } from 'svelte/store'
	import WorkerImageEditor from '#lib/components/worker/WorkerImageEditor.svelte'
	import { afterNavigate, goto, onNavigate } from '$app/navigation'
	import { page } from '$app/state'
	import { SkipControl } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import WorkspaceIntegrityNotice from '#lib/components/workspaces/WorkspaceIntegrityNotice.svelte'
	import MutationRejectionNotice from '#lib/components/shared/MutationRejectionNotice.svelte'
	import JazzStartup from '#lib/components/startup/JazzStartup.svelte'
	import DemoViewport from '#lib/components/diagnostics/DemoViewport.svelte'
	import DeveloperMenu from '#lib/components/diagnostics/DeveloperMenu.svelte'
	import AppDrawerStatus from '#lib/components/navigation/AppDrawerStatus.svelte'
	import WorkspaceBackup from '#lib/components/workspaces/WorkspaceBackup.svelte'
	import WorkerAccounts from '#lib/components/worker/WorkerAccounts.svelte'
	import { createFinanceWorkerClient } from '#lib/runtime/worker/client.js'
	import { setFinanceWorker, type FinanceWorkerClient } from '#lib/runtime/worker/context.js'

	let { children: routeContent }: { children: Snippet } = $props()
	let client = $state.raw<FinanceWorkerClient>()
	let serverUrl = $state('')
	const emptyImageEditor = readable(null)
	const imageEditor = $derived(client?.imageEditor ?? emptyImageEditor)
	const live = $derived(client ? fromStore(client.view) : undefined)
	setFinanceWorker({
		get client() {
			if (!client) throw new Error('Finance worker has not mounted')
			return client
		}
	})
	onMount(() => {
		serverUrl = new URL(
			PUBLIC_JAZZ_SERVER_URL === 'same-origin' ? '/jazz' : PUBLIC_JAZZ_SERVER_URL || '/jazz',
			window.location.origin
		).href
		const owner = createFinanceWorkerClient(
			{
				serverUrl,
				scope:
					(PUBLIC_JAZZ_SERVER_URL !== 'same-origin' ? PUBLIC_JAZZ_APP_ID : '') ||
					serverUrl.replace(/\/+$/, ''),
				environment: window.location.origin
			},
			async (destination, signal, origin, replace = false) => {
				signal.throwIfAborted()
				if (`${location.pathname}${location.search}${location.hash}` !== origin) return
				await goto(destination, {
					replace,
					shallow: replace && new URL(destination, location.href).pathname === location.pathname,
					state: page.state
				})
			}
		)
		client = owner
		owner.observeRoute()
		return () => owner.close()
	})
	afterNavigate(() => client?.observeRoute())

	onNavigate((navigation) => {
		if (!navigation.from?.route.id?.startsWith('/(transactions)/')) return
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

<SkipControl href="#main-content">{m['navigation.skip_to_main_content']()}</SkipControl>
<DemoViewport enabled={PUBLIC_SIMPLEFIN_DEMO === 'true'} />
<main id="main-content">
	{#if client}
		<DeveloperMenu appId={PUBLIC_JAZZ_APP_ID} {serverUrl} />
		<WorkerAccounts
			view={client.view}
			location={client.location}
			onRetryWorkspaceNavigation={client.retryWorkspaceNavigation}
			onSelectWorkspace={client.navigateWorkspace}
			onAccountCreation={client.accountCreationCommand}
			onAccountOrder={client.accountOrderCommand}
			onSelectAccount={client.selectAccount}
			onSelectAllAccounts={client.selectAllAccounts}
		>
			{#snippet footer()}
				<AppDrawerStatus
					syncConfigured
					browserOffline={live?.current.bank?.offline ?? true}
					bankSync={{
						visible: live?.current.bank?.view.mode.kind === 'connected',
						disabled:
							!live?.current.bank?.canSync || live.current.bank.view.activity.kind === 'working',
						loading: live?.current.bank?.view.activity.kind === 'working',
						sync: () => {
							if (live) client?.bankCommand({ type: 'SYNC' }, live.current)
						}
					}}
				/>
			{/snippet}
			{#snippet notices(view)}
				<MutationRejectionNotice
					notice={view.mutationRejected}
					onDismiss={() => client?.dismissMutationNotice(view)}
				/>
				{#if view.workspaceIntegrity}<WorkspaceIntegrityNotice
						view={view.workspaceIntegrity}
						onRetry={() => client?.retryIntegrity(view)}
					/>{/if}
				{#if view.status === 'starting'}<JazzStartup />{/if}
				{#if view.workspaceStartup === 'checking'}<JazzStartup workspace />{/if}
				{#if view.canRetrySession}<JazzStartup error onRetry={() => client?.retrySession()} />{/if}
				{#if view.backup?.canReload && page.url.pathname !== '/settings/workspace'}
					<WorkspaceBackup
						kind="download"
						view={view.backup}
						ondownload={(protection, password) => client?.startBackup(protection, password, view)}
						oncancel={() => client?.backupCommand('CANCEL', view)}
						onreload={() => client?.backupCommand('RELOAD', view)}
					/>
				{/if}
				{#if view.workspaceStartup === 'failed' || view.workspaceStartup === 'unavailable'}<JazzStartup
						workspace
						error
						{...view.canRetryInitialization
							? { onRetry: () => client?.retryInitialization(view) }
							: {}}
					/>{/if}
			{/snippet}
			{#snippet children()}
				{@render routeContent()}
			{/snippet}
		</WorkerAccounts>
	{:else}
		<JazzStartup />
	{/if}
	{#if client && live?.current.workspaceRestore?.visibleOutsideSettings && (page.url.pathname !== '/settings/workspace' || !live.current.workspaceNavigation?.showContent)}
		<WorkspaceBackup
			kind="restore"
			view={live.current.workspaceRestore}
			onrestore={(file, password) => client?.startWorkspaceRestore(file, password, live.current)}
			oncommand={(command) => client?.workspaceRestoreCommand(command, live.current)}
		/>
	{/if}
	{#if client && $imageEditor}
		{#key $imageEditor.port}<WorkerImageEditor
				file={$imageEditor.file}
				port={$imageEditor.port}
				onfinish={client.closeImageEditor}
			/>{/key}
	{/if}
</main>
