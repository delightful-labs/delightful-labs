<script lang="ts">
	import { setContext, untrack, type Snippet, type ComponentProps } from 'svelte'
	import {
		bankSyncKey,
		type BankSyncContext,
		type BankSyncControls,
		type BankSyncEvent,
		type BankSyncActor,
		type BankSyncSnapshot
	} from '#lib/runtime/bank-sync.js'
	import { getWorkspace } from '#lib/runtime/workspace.js'
	import type { WorkspaceLease } from 'delightful-local-first/workspace/contracts'
	import { workspaceBankActor, selectWorkspaceView } from '#lib/machines/runtime/readiness.js'
	import { beforeNavigate } from '$app/navigation'
	import { page } from '$app/state'
	import { createQuerySubscription } from 'delightful-local-first/backend/jazz/data'
	import { app } from '#lib/schema.js'
	import BankSyncLog from './BankSyncLog.svelte'
	import { selectBankLogPresentation } from '#lib/machines/bank-sync/history.js'
	import {
		selectHistoryConnection,
		historyPageLimit,
		initialHistoryPage,
		nextHistoryPage,
		selectHistoryPage,
		selectHistoryAccounts
	} from './bank-sync-history.js'
	import { fromStore, readable } from 'svelte/store'
	import { selectBankView } from '#lib/machines/bank-sync/index.js'
	import { createBankTrace } from '#lib/integrations/diagnostics.js'
	import { m } from '#lib/paraglide/messages.js'
	import BankSync from '#lib/components/banks/BankSync.svelte'
	import QueryContent from '#lib/components/shared/QueryContent.svelte'

	let {
		children,
		browserOffline,
		queries,
		userId,
		organizationId
	}: {
		browserOffline: boolean
		children: Snippet<[BankSyncControls]>
		queries: ComponentProps<typeof QueryContent>['queries']
		userId: string | undefined
		organizationId: string | null
	} = $props()
	const workspace = getWorkspace()
	const workspaceActor = workspace.actor
	if (!workspaceActor) throw new Error('Workspace integration must own the coordinator')
	const binding = readable<{ actor: BankSyncActor; lease: WorkspaceLease } | undefined>(
		undefined,
		(set) => {
			let current: BankSyncActor | undefined
			let currentLease: WorkspaceLease | undefined
			const subscription = workspaceActor.subscribe((state) => {
				const actor = workspaceBankActor(state)
				const lease = selectWorkspaceView(state).resourceLease
				if (actor === current && lease === currentLease) return
				current = actor
				currentLease = lease
				set(actor && lease ? { actor, lease } : undefined)
			})
			return () => subscription.unsubscribe()
		}
	)
	const bankBinding = fromStore(binding)
	const send = (event: BankSyncEvent, lease: WorkspaceLease | undefined) => {
		if (lease) workspaceActor.send({ type: 'BANK', lease, event })
	}
	const syncDisabled = $derived(!workspace.view.canSync)

	// Follow replacement references and subscribe directly to the selected bank's public snapshots.
	const snapshot = readable<BankSyncSnapshot | undefined>(undefined, (set) => {
		let child: { unsubscribe: () => void } | undefined
		const subscription = binding.subscribe((value) => {
			child?.unsubscribe()
			set(value?.actor.getSnapshot())
			child = value?.actor.subscribe(set)
		})
		return () => {
			child?.unsubscribe()
			subscription()
		}
	})
	const bankState = fromStore(snapshot)
	const view = $derived(selectBankView(bankState.current))
	const historyOrganizationId = $derived(
		page.url.pathname === '/settings/banks' && bankState.current?.context.access.kind === 'allowed'
			? bankState.current.context.access.organizationId
			: undefined
	)
	const logConnections = createQuerySubscription(() =>
		historyOrganizationId
			? app.simplefinConnections
					.where({ organizationId: historyOrganizationId })
					.orderBy('claimedAt', 'desc')
					.orderBy('id', 'desc')
			: undefined
	)
	const historyScope = $derived(`${userId}:${historyOrganizationId}`)
	let historySelection = $state({ scope: '', id: '' })
	const selectedHistory = $derived(
		selectHistoryConnection(
			logConnections.current ?? [],
			historyOrganizationId,
			historySelection,
			historyScope,
			bankState.current?.context.connection?.id
		)
	)
	const historyConnections = $derived(selectedHistory.connections)
	const logConnectionId = $derived(selectedHistory.connectionId)
	const logScope = $derived(`${userId}:${organizationId}:${logConnectionId}`)
	let logPage = $state(initialHistoryPage())
	const logLimit = $derived(historyPageLimit(logPage, logScope))
	$effect(() => {
		if (logPage.scope !== logScope) logPage = initialHistoryPage(logScope)
	})
	const logAttempts = createQuerySubscription(() =>
		logConnectionId && organizationId
			? app.simplefinSyncAttempts
					.where({ organizationId, connectionId: logConnectionId })
					.orderBy('startedAt', 'desc')
					.orderBy('id', 'desc')
					.limit(logLimit + 1)
			: undefined
	)
	const historyPage = $derived(
		selectHistoryPage(
			logAttempts.current ?? [],
			historyConnections,
			organizationId,
			logConnectionId,
			logLimit
		)
	)
	const attemptIds = $derived(historyPage.attemptIds)
	const logAccounts = createQuerySubscription(() =>
		organizationId && attemptIds.length
			? app.simplefinSyncAccountResults.where({ organizationId, attemptId: { in: attemptIds } })
			: undefined
	)
	const logProfiles = createQuerySubscription(() =>
		historyPage.initiatorIds.length
			? app.profiles.where({ userId: { in: historyPage.initiatorIds } })
			: undefined
	)
	const historyAccounts = $derived(
		selectHistoryAccounts(logAccounts.current ?? [], organizationId, attemptIds)
	)
	const logPresentation = $derived(
		selectBankLogPresentation({
			connections: historyConnections,
			attempts: historyPage.attempts,
			accounts: historyAccounts
		})
	)
	function selectConnection(id: string) {
		historySelection = { scope: historyScope, id }
	}
	function loadEarlier() {
		logPage = nextHistoryPage(logPage, logScope)
	}
	$effect(() => {
		const current = bankBinding.current
		const offline = browserOffline
		if (current)
			untrack(() => workspaceActor.send({ type: 'BANK_NETWORK', lease: current.lease, offline }))
	})
	const workflowTrace = createBankTrace('workflow')
	function dispatch(event: BankSyncEvent, lease: WorkspaceLease | undefined) {
		workflowTrace.log('event', {
			event: event.type,
			state:
				(view.mode.kind === 'setup' ? view.mode.stage : null) ??
				(bankState.current?.matches('running') ? 'running' : 'idle')
		})
		send(event, lease)
	}
	$effect(() => {
		workflowTrace.log('queries', {
			loading: queries.some((query) => query.isLoading),
			failed: queries.some((query) => Boolean(query.error))
		})
		for (const [index, query] of queries.entries()) {
			if (query.error) workflowTrace.failed(`query.${index}.failed`, query.error)
		}
	})

	const controls: BankSyncContext = {
		get actor() {
			return bankBinding.current?.actor
		},
		snapshot,
		get status() {
			return view.status
		},
		get outcome() {
			return view.history
		},
		get visible() {
			return view.mode.kind === 'connected'
		},
		get disabled() {
			return view.activity.kind === 'working' || syncDisabled
		},
		get loading() {
			return view.activity.kind === 'working'
		},
		sync: () => dispatch({ type: 'SYNC' }, bankBinding.current?.lease),
		get view() {
			return bankView
		}
	}
	setContext(bankSyncKey, controls)
	beforeNavigate((navigation) => {
		const state = bankState.current
		// Workspace ownership survives client navigation; its access/shutdown paths drain sync.
		if (!navigation.willUnload && state?.context.command?.type === 'SYNC') return
		dispatch({ type: 'CANCEL' }, bankBinding.current?.lease)
	})
</script>

{#snippet bankView()}
	<QueryContent
		{queries}
		loadingMessage={m['status.loading_subject']({ subject: m['bank.title']() })}
		errorMessage={m['errors.load_subject']({ subject: m['bank.title']() })}
	>
		{#key bankBinding.current?.lease}
			{@const lease = bankBinding.current?.lease}
			<BankSync
				{browserOffline}
				{view}
				{syncDisabled}
				onTestEncryption={() => dispatch({ type: 'TEST_ENCRYPTION' }, lease)}
				onVerifyDecryption={() => dispatch({ type: 'VERIFY_DECRYPTION' }, lease)}
				onSaveConnection={() => dispatch({ type: 'SAVE_CONNECTION' }, lease)}
				onConnect={(token) => dispatch({ type: 'CONNECT', token }, lease)}
				onDiscover={() => dispatch({ type: 'DISCOVER' }, lease)}
				onReconnect={() => dispatch({ type: 'RECONNECT' }, lease)}
				onSync={() => dispatch({ type: 'SYNC' }, lease)}
				onMap={(providerId, accountId) => dispatch({ type: 'MAP', providerId, accountId }, lease)}
				onCreateAccount={(providerId) => dispatch({ type: 'CREATE_ACCOUNT', providerId }, lease)}
				onDisconnect={() => dispatch({ type: 'DISCONNECT' }, lease)}
				onCancel={() => dispatch({ type: 'CANCEL' }, lease)}
			/>
			{#if historyOrganizationId}
				<QueryContent
					queries={[logConnections, logAttempts, logAccounts]}
					loadingMessage={m['status.loading_subject']({ subject: m['bank.log_title']() })}
					errorMessage={m['errors.load_subject']({ subject: m['bank.log_title']() })}
				>
					<BankSyncLog
						connections={logPresentation.connections}
						connectionId={logConnectionId}
						onConnection={selectConnection}
						attempts={logPresentation.attempts}
						accounts={logPresentation.accounts}
						profiles={logProfiles.error ? [] : (logProfiles.current ?? [])}
						hasEarlier={historyPage.hasEarlier}
						onEarlier={loadEarlier}
					/>
				</QueryContent>
			{/if}
		{/key}
	</QueryContent>
{/snippet}

{@render children(controls)}
