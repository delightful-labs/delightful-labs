import { mount, unmount } from 'svelte'
import { get } from 'svelte/store'
import WorkerAccounts from '../../src/lib/components/worker/WorkerAccounts.svelte'
import { createFinanceWorkerClient } from '../../src/lib/runtime/worker/client.js'
import type { FinanceWorkerOpen } from '../../src/lib/contracts/worker-application.js'

let worker: Worker | undefined, client: ReturnType<typeof createFinanceWorkerClient> | undefined
let component: ReturnType<typeof mount> | undefined
let scope = ''
function current() {
	if (!client) throw new Error('Fixture not open')
	return client
}
function attach() {
	const target = document.getElementById('app')
	if (!target) throw new Error('Fixture target missing')
	const owner = current()
	component = mount(WorkerAccounts, {
		target,
		props: {
			view: owner.view,
			onSelectWorkspace: owner.selectWorkspace,
			onArchive: owner.archiveAccount
		}
	})
}
function request(message: unknown) {
	if (!worker) throw new Error('Fixture Worker unavailable')
	const channel = new MessageChannel()
	const result = new Promise<{ ok: boolean; error?: string }>((resolve) => {
		channel.port1.onmessage = ({ data }) => {
			channel.port1.close()
			resolve(data)
		}
	})
	worker.postMessage(message, [channel.port2])
	return result
}
const fixture = {
	open(configuration: Omit<FinanceWorkerOpen, 'type'>) {
		scope = configuration.scope
		client = createFinanceWorkerClient(configuration, () => {
			worker = new Worker(
				new URL('../../src/lib/runtime/worker/application.worker.ts', import.meta.url),
				{ type: 'module' }
			)
			return worker
		})
		attach()
	},
	state: () => get(current().view),
	seed: (workspaceId: string, accountId: string, name: string) =>
		request({ type: 'TEST_SEED', workspaceId, accountId, name }),
	edit: (accountId: string, name: string) => request({ type: 'TEST_EDIT', accountId, name }),
	archive: (accountId: string) => current().archiveAccount(accountId),
	holdArchive: () => request({ type: 'TEST_HOLD_ARCHIVE' }),
	releaseArchive: () => request({ type: 'TEST_RELEASE_ARCHIVE' }),
	select: (workspaceId: string) => current().selectWorkspace(workspaceId),
	async detach() {
		if (component) await unmount(component)
		component = undefined
	},
	attach,
	badView: () => request({ type: 'TEST_BAD_VIEW' }),
	close: () => current().close(),
	scope: () => scope
}
declare global {
	interface Window {
		financeWorkerReadFixture: typeof fixture
	}
}
window.financeWorkerReadFixture = fixture
