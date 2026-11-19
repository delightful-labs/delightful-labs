import { acceptInspection } from '../../diagnostics/inspector.js'
import {
	financeBankConnectRequest,
	type WorkerBankCommand,
	type WorkerBankHistoryCommand
} from '../../contracts/worker-banks.js'
import { dispatchWindowWebAuthn } from '../../integrations/webauthn.js'
import type { WorkerTransactionImageCommand } from '../../contracts/worker-images.js'
import type { WorkerTransferEditCommand } from '../../contracts/worker-transfers.js'
import {
	financeBackupRequest,
	financeWorkspaceRestoreRequest
} from '../../contracts/worker-backup.js'
import { dispatchWindowBackup } from './download.js'
import type { WorkspaceRestoreCommand } from '../../machines/workspaces/workspace-restore.js'
import type { WorkerWorkspaceCreationCommand } from '../../contracts/worker-forms.js'
import { replyWithWindowNavigation } from './navigation.js'
import type { WorkspaceNavigate } from '../../contracts/workspace-orchestration-contract.js'
import type {
	RecoveryScope,
	RecoveryScopeSource,
	RecoveryPhraseCapability
} from 'delightful-local-first/recovery/contracts'
import type { TransactionListFilters } from '../../filters/transaction-list-filters.js'
import {
	transactionListLocation,
	transactionListQuery
} from '../../domain/transaction-list-routes.js'
import { withQueryParams } from '../../domain/query-params.js'
import { workspaceRoute } from '../../domain/workspace-routes.js'
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
	type FinanceWorkerView,
	type WorkerCommandScope,
	type FinanceWorkerConfiguration
} from '../../contracts/worker-application.js'
import { EXPENSE, type TransactionKind } from '../../domain/transaction-kind.js'
import type {
	WorkerFormCommand,
	ClassificationForm,
	WorkerAccountOrderCommand
} from '../../contracts/worker-forms.js'

// Callers may pass a complete view. Transport only the command's scope fields.
function commandScope({ sessionRevision, selection }: WorkerCommandScope): WorkerCommandScope {
	return { sessionRevision, selection }
}

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
	const imageEditor = writable<{ file: File; port: MessagePort } | null>(null)
	const observedLocation = writable(new URL(location.href))
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
			feedback: 'none',
			draftRevision: 0,
			navigationOnly: false,
			navigationError: false,
			canRetryNavigation: false
		},
		workspaceStartup: null,
		accountCreation: null,
		accountArchive: null,
		accountAccess: null,
		accountOrder: null,
		classification: null,
		backup: null,
		workspaceRestore: null,
		workspaceCreation: null,
		profile: null,
		workspace: null,
		transactionEntry: null,
		transactionEdit: null,
		samples: null,
		canRetrySession: false,
		canRetryInitialization: false,
		workspaceIntegrity: null,
		mutationRejected: false,
		bank: null,
		transactionDetails: null,
		transferEdit: null,
		transferCreation: null,
		transfers: null,
		overview: null,
		ledger: null
	})
	let transportFailed = false
	const fail = () => {
		transportFailed = true
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
				feedback: 'sessionFailed'
			},
			workspaceNavigation: null,
			accounts: [],
			selectedAccountIds: null,
			workspaces: null,
			archiveFeedback: null,
			recoveryAvailable: false,
			workspaceStartup: null,
			accountCreation: null,
			accountArchive: null,
			accountAccess: null,
			accountOrder: null,
			classification: null,
			backup: null,
			workspaceRestore: null,
			workspaceCreation: null,
			profile: null,
			workspace: null,
			transactionEntry: null,
			transactionEdit: null,
			samples: null,
			canRetrySession: true,
			canRetryInitialization: false,
			workspaceIntegrity: null,
			mutationRejected: false,
			bank: null,
			transactionDetails: null,
			transferEdit: null,
			transferCreation: null,
			transfers: null,
			overview: null,
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
		if (decoded.data.type === 'INSPECTION') {
			acceptInspection(decoded.data.event)
			return
		}
		if (decoded.data.type === 'WEBAUTHN') {
			const port = event.ports[0]
			if (port && event.ports.length === 1) void dispatchWindowWebAuthn(port, decoded.data)
			else fail()
			return
		}
		if (decoded.data.type === 'EDIT_IMAGE') {
			const port = event.ports[0]
			if (!port || event.ports.length !== 1) {
				fail()
				return
			}
			if (get(imageEditor)) {
				port.postMessage({ kind: 'failed', reason: 'input' })
				port.close()
				return
			}
			imageEditor.set({ file: decoded.data.file, port })
			return
		}
		if (decoded.data.type === 'DOWNLOAD_BACKUP') {
			const port = event.ports[0]
			if (port && event.ports.length === 1) dispatchWindowBackup(port, decoded.data.bytes)
			else fail()
			return
		}
		if (decoded.data.type === 'RELOAD_PAGE') {
			window.location.reload()
			return
		}
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
		window.removeEventListener('online', observeNetwork)
		window.removeEventListener('offline', observeNetwork)
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
				feedback: 'none'
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
			accountArchive: null,
			accountAccess: null,
			accountOrder: null,
			classification: null,
			backup: null,
			workspaceRestore: null,
			workspaceCreation: null,
			profile: null,
			workspace: null,
			transactionEntry: null,
			transactionEdit: null,
			samples: null,
			canRetrySession: false,
			canRetryInitialization: false,
			workspaceIntegrity: null,
			mutationRejected: false,
			bank: null,
			transactionDetails: null,
			transferEdit: null,
			transferCreation: null,
			transfers: null,
			overview: null,
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
		observedLocation.set(new URL(location.href))
		worker.postMessage(
			financeWorkerCommand.parse({ type: 'OBSERVE_LOCATION', href: relativeHref() })
		)
	}
	function observeNetwork() {
		worker.postMessage(
			financeWorkerCommand.parse({ type: 'OBSERVE_NETWORK', offline: !navigator.onLine })
		)
	}
	worker.postMessage(open, [data.port2, control.port2])
	observeLocation()
	observeNetwork()
	window.addEventListener('popstate', observeLocation)
	window.addEventListener('online', observeNetwork)
	window.addEventListener('offline', observeNetwork)
	const view: Readable<FinanceWorkerView> = { subscribe: state.subscribe }
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
	let observedRouteHref: string | undefined
	function observeRoute() {
		const current = get(state)
		if (current.status === 'closed') return
		const href = relativeHref()
		if (observedRouteHref === href) return
		const previous = observedRouteHref ? new URL(observedRouteHref, location.href) : undefined
		observedRouteHref = href
		observedLocation.set(new URL(location.href))
		window.addEventListener('popstate', observeRoute)
		const command = financeWorkerCommand.parse({
			type: 'OBSERVE_ROUTE',
			pathname: location.pathname,
			search: location.search,
			hash: location.hash,
			revision: revision + 1
		})
		revision += 1
		// Query edits preserve the current form. A different page or workspace
		// waits for its own worker view instead of mounting with the previous page's form.
		if (
			previous &&
			(previous.pathname !== location.pathname ||
				previous.searchParams.get('workspace') !==
					new URLSearchParams(location.search).get('workspace'))
		)
			state.update((view) => ({ ...view, workspaceNavigation: null }))

		worker.postMessage(command)
	}

	return {
		imageEditor: { subscribe: imageEditor.subscribe },
		closeImageEditor: () => imageEditor.set(null),
		location: { subscribe: observedLocation.subscribe },
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
					selection:
						observedRouteHref === undefined
							? current.selection
							: {
									workspaceId: workspaceRoute(location.search).workspaceId,
									revision
								}
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
		navigateTransaction: (transactionId: string | null, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'OPEN_TRANSACTION',
					transactionId,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		setAccountDeleteGrant: (
			accountId: string,
			userId: string,
			canDelete: boolean,
			scope: WorkerCommandScope
		) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'SET_ACCOUNT_DELETE_GRANT',
					accountId,
					userId,
					canDelete,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
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
		startBackup: (protection: 'none' | 'password', password: string, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeBackupRequest.parse({
					type: 'START_BACKUP',
					protection,
					password,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		startWorkspaceRestore: (file: File, password: string, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkspaceRestoreRequest.parse({
					type: 'START_WORKSPACE_RESTORE',
					file,
					password,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		backupCommand: (command: 'CANCEL' | 'RELOAD', scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'BACKUP_COMMAND',
					command,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		workspaceRestoreCommand: (
			command: WorkspaceRestoreCommand['type'],
			scope: WorkerCommandScope
		) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'WORKSPACE_RESTORE_COMMAND',
					command,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		workspaceCreationCommand: (
			command: WorkerWorkspaceCreationCommand,
			scope: WorkerCommandScope
		) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'WORKSPACE_CREATION',
					command,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		profileCommand: (
			form: 'name' | 'avatar',
			command: WorkerFormCommand,
			scope: WorkerCommandScope
		) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'PROFILE',
					form,
					command,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		workspaceSettingsCommand: (command: WorkerFormCommand, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'WORKSPACE_SETTINGS',
					command,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		classificationCommand: (
			form: ClassificationForm,
			command: WorkerFormCommand,
			scope: WorkerCommandScope
		) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'CLASSIFICATION',
					form,
					command,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		accountOrderCommand: (command: WorkerAccountOrderCommand, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'ACCOUNT_ORDER',
					command,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		accountCreationCommand: (command: WorkerFormCommand, scope: WorkerCommandScope) => {
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
		addSamples: (kind: TransactionKind, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'ADD_SAMPLES',
					kind,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		retrySession: () => {
			if (transportFailed) window.location.reload()
			else worker.postMessage(financeWorkerCommand.parse({ type: 'RETRY_SESSION' }))
		},
		retryInitialization: (scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'RETRY_INITIALIZATION',
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		retryIntegrity: (scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'RETRY_INTEGRITY',
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		dismissMutationNotice: (scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'DISMISS_MUTATION_NOTICE',
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		bankCommand: (command: WorkerBankCommand, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({ type: 'BANK', command, ...commandScope(scope) })
			),
		bankHistoryCommand: (command: WorkerBankHistoryCommand, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({ type: 'BANK_HISTORY', command, ...commandScope(scope) })
			),
		connectBank: (token: string, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeBankConnectRequest.parse({
					type: 'BANK_CONNECT',
					token,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		transactionImageCommand: (command: WorkerTransactionImageCommand, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({ type: 'TRANSACTION_IMAGE', command, ...commandScope(scope) })
			),
		transferEditCommand: (command: WorkerTransferEditCommand, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({ type: 'TRANSFER_EDIT', command, ...commandScope(scope) })
			),
		transferEntryCommand: (command: WorkerFormCommand, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({ type: 'TRANSFER_ENTRY', command, ...commandScope(scope) })
			),
		transactionEditCommand: (command: WorkerFormCommand, scope: WorkerCommandScope) => {
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
		transactionEntryCommand: (command: WorkerFormCommand, scope: WorkerCommandScope) => {
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
				financeWorkerCommand.parse({
					type: 'SET_ACCOUNT_SELECTED',
					accountId,
					checked,
					...commandScope(scope)
				})
			),
		selectAllAccounts: (checked: boolean, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'SET_ALL_ACCOUNTS_SELECTED',
					checked,
					...commandScope(scope)
				})
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
		setOverviewFilters: (filters: TransactionListFilters, scope: WorkerCommandScope) =>
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'SET_OVERVIEW_FILTERS',
					filters,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			),
		setLedgerFilters: (change: Partial<TransactionListFilters>, scope: WorkerCommandScope) => {
			const current = get(state)
			if (
				current.status !== 'ready' ||
				current.sessionRevision !== scope.sessionRevision ||
				current.selection.revision !== scope.selection.revision ||
				current.selection.workspaceId !== scope.selection.workspaceId
			)
				return
			if (observedRouteHref !== undefined) {
				// Query controls are native UI navigation. Read the current URL,
				// rather than replacing other fields from an older worker DTO.
				const origin = relativeHref()
				const filters = { ...transactionListLocation(location.search).filters, ...change }
				const destination = withQueryParams(origin, transactionListQuery(filters, 1))
				void navigate(destination, new AbortController().signal, origin, true).then(
					observeRoute,
					fail
				)
				return
			}
			// Standalone hosts can select a context without owning a browser route.
			if (!current.ledger) return
			worker.postMessage(
				financeWorkerCommand.parse({
					type: 'SET_LEDGER_FILTERS',
					filters: { ...current.ledger.filters, ...change },
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
			)
		},
		close: () => worker.postMessage({ type: 'CLOSE' })
	}
}
