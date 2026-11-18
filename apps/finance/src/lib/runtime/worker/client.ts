import { get, writable, type Readable } from 'svelte/store'
import { serveBrowserWorkerHost } from 'delightful-local-first/backend/jazz/worker-broker'
import brokerUrl from '#jazz-broker-worker?sharedworker&url'
import {
	financeWorkerOpen,
	financeWorkerReply,
	workerSelection,
	type FinanceWorkerView,
	type FinanceWorkerOpen
} from '../../contracts/worker-application.js'

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
		selection: { workspaceId: null, revision },
		status: 'starting',
		identityId: null,
		workspaces: null,
		accounts: []
	})
	const fail = () => {
		// Keep the close receipt listener: a data fault never authorizes termination.
		worker.removeEventListener('message', receiveView)
		state.update((view) => ({ ...view, status: 'failed', accounts: [], workspaces: null }))
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
			identityId: null
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
				accounts: []
			}))
			worker.postMessage({ type: 'SELECT_WORKSPACE', selection })
		},
		close: () => worker.postMessage({ type: 'CLOSE' })
	}
}
