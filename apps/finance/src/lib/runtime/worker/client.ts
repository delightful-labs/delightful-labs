import type { TransactionListFilters } from '../../filters/transaction-list-filters.js'
import { get, writable, type Readable } from 'svelte/store'
import { serveBrowserWorkerHost } from 'delightful-local-first/backend/jazz/worker-broker'
import brokerUrl from '#jazz-broker-worker?sharedworker&url'
import {
	financeWorkerOpen,
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
	WorkerAccountCreationCommand
} from '../../contracts/worker-forms.js'

/** Window owns native transport and rendering only. Domain state stays in the Worker. */
export function createFinanceWorkerClient(
	configuration: FinanceWorkerConfiguration,
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
		workspaces: null,
		accounts: [],
		archiveFeedback: null,
		workspaceStartup: null,
		accountCreation: null,
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
			accounts: [],
			workspaces: null,
			archiveFeedback: null,
			workspaceStartup: null,
			accountCreation: null,
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
		if (decoded.data.type === 'FAILED') {
			fail()
			return
		}
		worker.removeEventListener('message', receiveView)
		worker.removeEventListener('message', receiveControl)
		worker.removeEventListener('error', fail)
		worker.removeEventListener('messageerror', fail)
		worker.terminate()
		releaseBroker()
		state.update((view) => ({
			...view,
			status: 'closed',
			accounts: [],
			workspaces: null,
			identityId: null,
			archiveFeedback: null,
			workspaceStartup: null,
			accountCreation: null,
			transactionEntry: null,
			transactionEdit: null,
			ledger: null
		}))
	}
	worker.addEventListener('message', receiveView)
	worker.addEventListener('message', receiveControl)
	worker.addEventListener('error', fail)
	worker.addEventListener('messageerror', fail)
	worker.postMessage(open, [data.port2, control.port2])
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
			accounts: [],
			archiveFeedback: null,
			workspaceStartup: null,
			accountCreation: null,
			transactionEntry: null,
			transactionEdit: null,
			ledger: null
		}))
		worker.postMessage(command)
	}
	return {
		view,
		selectWorkspace: (workspaceId: string | null) =>
			selectContext(workspaceId, get(state).transactionKind),
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
