<script lang="ts">
	import 'delightful-ui/theme.css'
	import { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'
	import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
	import { inspectActor } from '#lib/diagnostics/inspector.js'
	import {
		PUBLIC_JAZZ_APP_ID,
		PUBLIC_JAZZ_SERVER_URL,
		PUBLIC_SIMPLEFIN_DEMO
	} from '$app/env/public'
	import { onDestroy, onMount, setContext, type Snippet } from 'svelte'
	import { createActor } from 'xstate'
	import { prepareWorkspaceRestoreFile } from '#lib/machines/workspaces/workspace-restore.js'
	import { fromStore, readable } from 'svelte/store'
	import {
		createApplicationReadinessMachine,
		selectApplicationWorkspaceRestore
	} from '#lib/machines/runtime/application-readiness.js'
	import { readinessKey, type ReadinessContext } from '#lib/runtime/bank-sync.js'
	import { JazzSessionProvider } from 'jazz-tools/svelte'
	import type { JazzClientConfig } from 'jazz-tools/client'
	import DeveloperMenu from '#lib/components/diagnostics/DeveloperMenu.svelte'
	import DemoViewport from '#lib/components/diagnostics/DemoViewport.svelte'
	import JazzStartup from '#lib/components/startup/JazzStartup.svelte'
	import PwaUpdateIntegration from '#lib/components/pwa/PwaUpdateIntegration.svelte'
	import SessionStartup from '#lib/components/startup/SessionStartup.svelte'
	import WorkspaceBackup from '#lib/components/workspaces/WorkspaceBackup.svelte'
	import WorkspaceBootstrap from '#lib/components/workspaces/WorkspaceBootstrap.svelte'
	import MutationRejectionNotice from '#lib/components/shared/MutationRejectionNotice.svelte'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { queryLinksKey, type QueryLinkContext } from '#lib/filters/query-links.js'
	import { browser } from '$app/env'
	import { workspaceRoute } from '#lib/domain/workspace-routes.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/filters/finance-filters.js'
	import {
		getCurrentJazzSession,
		getCurrentSessionAvailability,
		getJazzStartupBinding,
		loadLocalFirstClient,
		prepareLocalFirstSession
	} from '#lib/runtime/jazz-session.js'

	let { children }: { children: Snippet } = $props()
	const routeWorkspaceId = $derived(browser ? workspaceRoute(page.url.search).workspaceId : null)
	const accountFilter = $state<{ scope: string | null; ids: string[] | null }>({
		scope: null,
		ids: null
	})
	$effect.pre(() => {
		if (accountFilter.scope !== routeWorkspaceId) {
			accountFilter.scope = routeWorkspaceId
			accountFilter.ids = null
		}
	})
	const financeFilters: FinanceFilters = {
		get activeOrganizationId() {
			return routeWorkspaceId
		},
		get selectedAccountIds() {
			return accountFilter.scope === routeWorkspaceId ? accountFilter.ids : null
		},
		set selectedAccountIds(value) {
			accountFilter.scope = routeWorkspaceId
			accountFilter.ids = value
		}
	}

	setContext<QueryLinkContext>(queryLinksKey, {
		get href() {
			return browser ? page.url.href : undefined
		},
		keys: ['workspace']
	})
	setContext(financeFiltersKey, financeFilters)

	const serverUrl = browser
		? new URL(
				PUBLIC_JAZZ_SERVER_URL === 'same-origin' ? '/jazz' : PUBLIC_JAZZ_SERVER_URL || '/jazz',
				window.location.origin
			).href
		: '/jazz'
	const legacyScope = PUBLIC_JAZZ_SERVER_URL !== 'same-origin' ? PUBLIC_JAZZ_APP_ID : ''
	const applicationId = legacyScope || serverUrl.replace(/\/+$/, '')
	const jazzConfig = {
		...(legacyScope ? { scope: legacyScope } : {}),
		client: loadLocalFirstClient,
		serverUrl,
		initial: 'local-first'
	} satisfies JazzClientConfig

	const actor = createActor(
		createApplicationReadinessMachine(
			{
				readHref: () => `${page.url.pathname}${page.url.search}${page.url.hash}`,
				navigate: (destination) => goto(destination),
				reload: () => window.location.reload()
			},
			(session) => createJazzRestorationAdapter(session, getCurrentJazzSession),
			createJazzSessionReadinessAdapter,
			{
				appId: applicationId,
				serverUrl: jazzConfig.serverUrl,
				environment: browser ? window.location.origin : 'finance'
			},
			prepareLocalFirstSession
		),
		{ inspect: inspectActor }
	).start()
	const snapshot = readable(actor.getSnapshot(), (set) => {
		const subscription = actor.subscribe(set)
		return () => subscription.unsubscribe()
	})
	const readiness: ReadinessContext = { actor, snapshot }
	setContext(readinessKey, readiness)
	const startupState = fromStore(snapshot)
	const jazzSession = $derived(startupState.current.context.session)
	const restoreView = $derived(selectApplicationWorkspaceRestore(startupState.current))
	let startupAvailability = $state<ReturnType<typeof getCurrentSessionAvailability>>()
	onMount(() => {
		const startup = getJazzStartupBinding(jazzConfig)
		const subscription = startup.owner.subscribe(() => {
			startupAvailability = getCurrentSessionAvailability()
		})
		actor.send({ type: 'START', startup })
		return () => subscription.unsubscribe()
	})
	// The machine completes only after its workspace/bank children finish cleanup.
	onDestroy(() => actor.send({ type: 'SHUTDOWN' }))
</script>

<DeveloperMenu appId={applicationId} serverUrl={jazzConfig.serverUrl} />

<DemoViewport enabled={PUBLIC_SIMPLEFIN_DEMO === 'true'} />

<MutationRejectionNotice
	notice={startupState.current.context.mutationNotice}
	onDismiss={() => actor.send({ type: 'DISMISS_MUTATION_REJECTION' })}
/>

{#snippet startup()}
	<SessionStartup waitingForOtherVersion={startupAvailability !== undefined} />
{/snippet}

{#if restoreView.visibleOutsideSettings && (page.url.pathname !== '/settings/workspace' || !startupState.current.matches( { running: 'ready' } ))}
	<WorkspaceBackup
		kind="restore"
		view={{ ...restoreView, editable: false }}
		onrestore={(file, password) =>
			actor.send({
				type: 'WORKSPACE_RESTORE',
				request: prepareWorkspaceRestoreFile(file, password)
			})}
		oncommand={(type) => actor.send({ type: 'WORKSPACE_RESTORE_COMMAND', command: { type } })}
	/>
{/if}
{#if !jazzSession || startupState.current.hasTag('startup-error')}
	<PwaUpdateIntegration />
{/if}
<main>
	{#if startupState.current.hasTag('startup-error')}
		<SessionStartup waitingForOtherVersion={startupAvailability !== undefined} />
	{:else if jazzSession}
		<JazzSessionProvider session={jazzSession} fallback={startup}>
			{#key startupState.current.context.attachmentRevision}
				<WorkspaceBootstrap>{@render children()}</WorkspaceBootstrap>
			{/key}
		</JazzSessionProvider>
	{:else}
		<JazzStartup
			error={startupState.current.hasTag('startup-error')}
			onRetry={() => actor.send({ type: 'RETRY' })}
		/>
	{/if}
</main>
