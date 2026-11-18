import { get, writable, type Readable } from 'svelte/store'
import { serveBrowserWorkerHost } from 'delightful-local-first/backend/jazz/worker-broker'
import brokerUrl from '#jazz-broker-worker?sharedworker&url'
import {
	financeWorkerOpen,
	financeWorkerCommand,
	financeWorkerReply,
	workerSelection,
	type FinanceWorkerView,
	type WorkerCommandScope,
	type FinanceWorkerOpen
} from '../../contracts/worker-application.js'
import type { WorkerAccountCreationCommand } from '../../contracts/worker-forms.js'

/** Window owns native transport and rendering only. Domain state stays in the Worker. */
export function createFinanceWorkerClient(
	configuration: Omit<FinanceWorkerOpen, 'type'>,
	createWorker: () => Worker = () =>
		new Worker(new URL('./application.worker.ts', import.meta.url), { type: 'module' })
) {
	const open = financeWorkerOpen.parse({ type: 'OPEN', ...configuration })
	const worker = createWorker()
	const data = new MessageChannel(),
		control = new MessageChannel()
	const releaseBroker = serveBrowserWorkerHost(data.port1, control.port1, open.scope, {
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
		selection: { workspaceId: null, revision },
		status: 'starting',
		identityId: null,
		workspaces: null,
		accounts: [],
		archiveFeedback: null,
		accountCreation: null
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
			accountCreation: null
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
			accountCreation: null
		}))
	}
	worker.addEventListener('message', receiveView)
	worker.addEventListener('message', receiveControl)
	worker.addEventListener('error', fail)
	worker.addEventListener('messageerror', fail)
	worker.postMessage(open, [data.port2, control.port2])
	const view: Readable<FinanceWorkerView> = { subscribe: state.subscribe }
	return {
		view,
		selectWorkspace: (workspaceId: string | null) => {
			if (get(state).status === 'closed') return
			const selection = workerSelection.parse({ workspaceId, revision: revision + 1 })
			revision = selection.revision
			state.update((view) => ({
				...view,
				selection,
				status: view.status === 'failed' ? 'failed' : 'loading',
				accounts: [],
				archiveFeedback: null,
				accountCreation: null
			}))
			worker.postMessage({ type: 'SELECT_WORKSPACE', selection })
		},
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
		close: () => worker.postMessage({ type: 'CLOSE' })
	}
}
