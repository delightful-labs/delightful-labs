import { replyWithWindowNavigation } from './navigation.js'
import type { WorkspaceNavigate } from '../../contracts/workspace-orchestration-contract.js'
import type {
	RecoveryScope,
	RecoveryScopeSource,
	RecoveryPhraseCapability
} from 'delightful-local-first/recovery/contracts'
import type { TransactionListFilters } from '../../filters/transaction-list-filters.js'
import { get, writable, type Readable } from 'svelte/store'
import { serveBrowserWorkerHost } from 'delightful-local-first/backend/jazz/worker-broker'
import brokerUrl from '#jazz-broker-worker?sharedworker&url'
import {
	financeWorkerOpen,
	financeRecoveryRead,
	financeIdentityRestore,
	financeRecoveryRetry,
	financeRecoveryReply,
	financeWorkerCommand,
	financeWorkerReply,
	workerContextCommand,
	type FinanceWorkerView,
	type WorkerCommandScope,
	type FinanceWorkerConfiguration
} from '../../contracts/worker-application.js'
import { EXPENSE, type TransactionKind } from '../../domain/transaction-kind.js'
import type {
	WorkerTransactionEntryCommand,
	WorkerAccountOrderCommand,
	WorkerAccountCreationCommand
} from '../../contracts/worker-forms.js'

/** Window owns native transport and rendering only. Domain state stays in the Worker. */
export function createFinanceWorkerClient(
	configuration: FinanceWorkerConfiguration,
	navigate: WorkspaceNavigate,
	createWorker: () => Worker = () =>
		new Worker(new URL('./application.worker.ts', import.meta.url), { type: 'module' })
) {
	const open = financeWorkerOpen.parse({
		type: 'OPEN',
		...configuration,
		hostId: crypto.randomUUID()
	})
	const worker = createWorker()
	const data = new MessageChannel(),
		control = new MessageChannel()
	const releaseBroker = serveBrowserWorkerHost(data.port1, control.port1, open.hostId, {
		origin: location.origin,
		brokerWorkerUrl: new URL(brokerUrl, location.href).href,
		storage: {
			getItem: (key) => localStorage.getItem(key),
			setItem: (key, value) => localStorage.setItem(key, value)
		},
		open: (url, name) => new SharedWorker(url, { type: 'module', name })
	})
	let revision = 0
	const state = writable<FinanceWorkerView>({
		type: 'VIEW',
		sessionRevision: 0,
		transactionKind: EXPENSE,
		transactionId: null,
		selection: { workspaceId: null, revision },
		status: 'starting',
		identityId: null,
		selectedAccountIds: null,
		workspaces: null,
		accounts: [],
		archiveFeedback: null,
		workspaceNavigation: null,
		recoveryAvailable: false,
		identityRestore: {
			canSubmit: false,
			busy: false,
			error: false,
			draftRevision: 0,
			navigationOnly: false,
			navigationError: false,
			canRetryNavigation: false
		},
		workspaceStartup: null,
		accountCreation: null,
		accountOrder: null,
		transactionEntry: null,
		transactionEdit: null,
		ledger: null
	})
	const fail = () => {
		// Keep the close receipt listener: a data fault never authorizes termination.
		worker.removeEventListener('message', receiveView)
		state.update((view) => ({
			...view,
			status: 'failed',
			identityRestore: {
				...view.identityRestore,
				canSubmit: false,
				canRetryNavigation: false,
				navigationOnly: false,
				navigationError: false,
				busy: false,
				error: true
			},
			workspaceNavigation: null,
			accounts: [],
			selectedAccountIds: null,
			workspaces: null,
			archiveFeedback: null,
			recoveryAvailable: false,
			workspaceStartup: null,
			accountCreation: null,
			accountOrder: null,
			transactionEntry: null,
			transactionEdit: null,
			ledger: null
		}))
	}
	const receiveView = (event: MessageEvent<unknown>) => {
		const decoded = financeWorkerReply.safeParse(event.data)
		if (!decoded.success) {
			fail()
			return
		}
		if (decoded.data.type === 'VIEW' && decoded.data.selection.revision === revision)
			state.set(decoded.data)
	}
	const receiveControl = (event: MessageEvent<unknown>) => {
		const decoded = financeWorkerReply.safeParse(event.data)
		if (!decoded.success || decoded.data.type === 'VIEW') return
		if (decoded.data.type === 'NAVIGATE') {
			const port = event.ports[0]
			if (port && event.ports.length === 1)
				void replyWithWindowNavigation(port, decoded.data, navigate).finally(observeLocation)
			else fail()
			return
		}
		if (decoded.data.type === 'FAILED') {
			fail()
			return
		}
		worker.removeEventListener('message', receiveView)
		worker.removeEventListener('message', receiveControl)
		worker.removeEventListener('error', fail)
		worker.removeEventListener('messageerror', fail)
		window.removeEventListener('popstate', observeLocation)
		window.removeEventListener('popstate', observeRoute)
		worker.terminate()
		releaseBroker()
		state.update((view) => ({
			...view,
			status: 'closed',
			identityRestore: {
				...view.identityRestore,
				canSubmit: false,
				canRetryNavigation: false,
				navigationOnly: false,
				navigationError: false,
				busy: false,
				error: false
			},
			workspaceNavigation: null,
			accounts: [],
			selectedAccountIds: null,
			workspaces: null,
			identityId: null,
			archiveFeedback: null,
			recoveryAvailable: false,
			workspaceStartup: null,
			accountCreation: null,
			accountOrder: null,
			transactionEntry: null,
			transactionEdit: null,
			ledger: null
		}))
	}
	worker.addEventListener('message', receiveView)
	worker.addEventListener('message', receiveControl)
	worker.addEventListener('error', fail)
	worker.addEventListener('messageerror', fail)
	function relativeHref() {
		return `${location.pathname}${location.search}${location.hash}`
	}
	function observeLocation() {
		worker.postMessage(
			financeWorkerCommand.parse({ type: 'OBSERVE_LOCATION', href: relativeHref() })
		)
	}
	worker.postMessage(open, [data.port2, control.port2])
	observeLocation()
	window.addEventListener('popstate', observeLocation)
	const view: Readable<FinanceWorkerView> = { subscribe: state.subscribe }
	function selectContext(
		workspaceId: string | null,
		kind: TransactionKind,
		transactionId: string | null = null
	) {
		if (get(state).status === 'closed') return
		const command = workerContextCommand.parse({
			type: 'SELECT_CONTEXT',
			selection: { workspaceId, revision: revision + 1 },
			kind,
			transactionId
		})
		revision = command.selection.revision
		state.update((view) => ({
			...view,
			selection: command.selection,
			transactionKind: command.kind,
			transactionId: command.transactionId ?? null,
			status: view.status === 'failed' ? 'failed' : 'loading',
			workspaceNavigation: null,
			accounts: [],
			selectedAccountIds: null,
			archiveFeedback: null,
			recoveryAvailable: false,
			workspaceStartup: null,
			accountCreation: null,
			accountOrder: null,
			transactionEntry: null,
			transactionEdit: null,
			ledger: null
		}))
		worker.postMessage(command)
	}
	const recoveryToken = Object.freeze({})
	function currentRecoveryScope(view: FinanceWorkerView): RecoveryScope {
		return view.recoveryAvailable && view.identityId
			? {
					kind: 'available',
					binding: recoveryToken,
					identityId: view.identityId,
					generation: view.sessionRevision
				}
			: { kind: 'unavailable' }
	}
	const recoverySource: RecoveryScopeSource = {
		subscribe: (publish) => state.subscribe((view) => publish(currentRecoveryScope(view)))
	}
	const recoveryCurrent: RecoveryPhraseCapability['isCurrentScope'] = (scope) => {
		const current = get(state)
		return (
			current.recoveryAvailable &&
			scope.binding === recoveryToken &&
			scope.generation === current.sessionRevision &&
			scope.identityId === current.identityId
		)
	}
	const recoveryCapability: RecoveryPhraseCapability = {
		isCurrentScope: recoveryCurrent,
		readPhrase: (scope) => {
			if (!recoveryCurrent(scope)) return Promise.reject(new Error('Recovery unavailable'))
			const channel = new MessageChannel()
			return new Promise<string>((resolve, reject) => {
				const failed = () => {
					channel.port1.close()
					reject(new Error('Recovery unavailable'))
				}
				channel.port1.onmessageerror = failed
				channel.port1.onmessage = (event) => {
					channel.port1.close()
					const result = financeRecoveryReply.safeParse(event.data)
					if (result.success && result.data.outcome === 'ready' && recoveryCurrent(scope))
						resolve(result.data.phrase)
					else reject(new Error('Recovery unavailable'))
				}
				try {
					worker.postMessage(
						financeRecoveryRead.parse({
							type: 'READ_RECOVERY_PHRASE',
							sessionRevision: scope.generation
						}),
						[channel.port2]
					)
				} catch {
					channel.port2.close()
					failed()
				}
			})
		}
	}
	function observeRoute() {
		const current = get(state)
		if (current.status === 'closed') return
		window.addEventListener('popstate', observeRoute)
		const command = financeWorkerCommand.parse({
			type: 'OBSERVE_ROUTE',
			pathname: location.pathname,
			search: location.search,
			hash: location.hash,
			revision: revision + 1
		})
		revision += 1
		// Keep the last bounded render until the Worker classifies the new route.
		// Older views and commands are rejected by their selection revision.

		worker.postMessage(command)
	}

	return {
		view,
		observeLocation,
		observeRoute,
		navigateWorkspace: (workspaceId: string) => {
			const current = get(state)
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'NAVIGATE_WORKSPACE',
					workspaceId,
					sessionRevision: current.sessionRevision,
					selection: current.selection
				})
			)
		},
		retryWorkspaceNavigation: () => {
			const current = get(state)
			if (current.workspaceNavigation?.canRetry)
				worker.postMessage(
					financeWorkerCommand.parse({
						type: 'RETRY_WORKSPACE_NAVIGATION',
						sessionRevision: current.sessionRevision,
						selection: current.selection
					})
				)
		},
		retryRecoveryNavigation: () => {
			const current = get(state)
			if (current.identityRestore.canRetryNavigation)
				worker.postMessage(
					financeRecoveryRetry.parse({
						type: 'RETRY_RECOVERY_NAVIGATION',
						sessionRevision: current.sessionRevision
					})
				)
		},
		restoreIdentity: (phrase: string) => {
			const current = get(state)
			if (!current.identityRestore.canSubmit) return
			worker.postMessage(
				financeIdentityRestore.parse({
					type: 'RESTORE_IDENTITY',
					origin: relativeHref(),
					sessionRevision: current.sessionRevision,
					phrase
				})
			)
		},
		recovery: { source: recoverySource, capability: recoveryCapability },
		selectWorkspace: (workspaceId: string | null) =>
			selectContext(workspaceId, get(state).transactionKind),
		navigateTransaction: (transactionId: string | null, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'OPEN_TRANSACTION',
					transactionId,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		selectTransaction: (transactionId: string | null) =>
			selectContext(get(state).selection.workspaceId, get(state).transactionKind, transactionId),
		selectTransactionKind: (kind: TransactionKind) =>
			selectContext(get(state).selection.workspaceId, kind),
		archiveAccount: (accountId: string, scope: WorkerCommandScope) => {
			const current = get(state)
			if (current.status !== 'ready') return
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'ARCHIVE_ACCOUNT',
					sessionRevision: scope.sessionRevision,
					selection: scope.selection,
					accountId
				})
			)
		},
		accountOrderCommand: (command: WorkerAccountOrderCommand, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'ACCOUNT_ORDER',
					command,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		accountCreationCommand: (command: WorkerAccountCreationCommand, scope: WorkerCommandScope) => {
			const current = get(state)
			if (
				current.status === 'closed' ||
				current.status === 'closing' ||
				current.status === 'failed'
			)
				return
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'ACCOUNT_CREATION',
					sessionRevision: scope.sessionRevision,
					selection: scope.selection,
					command
				})
			)
		},
		transactionEditCommand: (command: WorkerTransactionEntryCommand, scope: WorkerCommandScope) => {
			const current = get(state)
			if (
				current.status === 'closed' ||
				current.status === 'closing' ||
				current.status === 'failed'
			)
				return
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'TRANSACTION_EDIT',
					sessionRevision: scope.sessionRevision,
					selection: scope.selection,
					command
				})
			)
		},
		transactionEntryCommand: (
			command: WorkerTransactionEntryCommand,
			scope: WorkerCommandScope
		) => {
			const current = get(state)
			if (
				current.status === 'closed' ||
				current.status === 'closing' ||
				current.status === 'failed'
			)
				return
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'TRANSACTION_ENTRY',
					sessionRevision: scope.sessionRevision,
					selection: scope.selection,
					command
				})
			)
		},
		selectAccount: (accountId: string, checked: boolean, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({ type: 'SET_ACCOUNT_SELECTED', accountId, checked, ...scope })
			),
		selectAllAccounts: (checked: boolean, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({ type: 'SET_ALL_ACCOUNTS_SELECTED', checked, ...scope })
			),
		selectLedgerPage: (page: number, scope: WorkerCommandScope) => {
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'SET_LEDGER_PAGE',
					page,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			)
		},
		setLedgerFilters: (filters: TransactionListFilters, scope: WorkerCommandScope) => {
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'SET_LEDGER_FILTERS',
					filters,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			)
		},
		close: () => worker.postMessage({ type: 'CLOSE' })
	}
}
