import { mount, unmount } from 'svelte'
import { get } from 'svelte/store'
import WorkerAccounts from '../../src/lib/components/worker/WorkerAccounts.svelte'
import { createFinanceWorkerClient } from '../../src/lib/runtime/worker/client.js'
import type { FinanceWorkerConfiguration } from '../../src/lib/contracts/worker-application.js'

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
			recovery: owner.recovery,
			onSelectWorkspace: owner.selectWorkspace,
			onArchive: owner.archiveAccount,
			onAccountCreation: owner.accountCreationCommand,
			onTransactionEntry: owner.transactionEntryCommand,
			onTransactionEdit: owner.transactionEditCommand,
			onSelectTransaction: owner.selectTransaction,
			onLedgerPage: owner.selectLedgerPage,
			onLedgerFilters: owner.setLedgerFilters
		}
	})
}
function request(message: unknown) {
	if (!worker) throw new Error('Fixture Worker unavailable')
	const channel = new MessageChannel()
	const result = new Promise<{
		ok: boolean
		recoveryReads?: number
		error?: string
		transactions?: {
			id: string
			accountId: string
			checkNumber: string | null
			checkAccountId: string | null
			amountMinor: number
			currency: string
			kind: string
			description: string | null
			paymentMethod: string | null
			checkId: string | null
		}[]
	}>((resolve) => {
		channel.port1.onmessage = ({ data }) => {
			channel.port1.close()
			resolve(data)
		}
	})
	worker.postMessage(message, [channel.port2])
	return result
}
const fixture = {
	open(configuration: FinanceWorkerConfiguration) {
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
	recoveryReads: () => request({ type: 'TEST_RECOVERY_READS' }),
	state: () => get(current().view),
	seed: (workspaceId: string, accountId: string, name: string, currency: 'USD' | 'TZS' = 'USD') =>
		request({ type: 'TEST_SEED', workspaceId, accountId, name, currency }),
	edit: (accountId: string, name: string) => request({ type: 'TEST_EDIT', accountId, name }),
	seedLedger: (workspaceId: string, accountId: string) =>
		request({ type: 'TEST_SEED_LEDGER', workspaceId, accountId }),
	transactions: (workspaceId: string) => request({ type: 'TEST_TRANSACTIONS', workspaceId }),
	archive: (accountId: string) => current().archiveAccount(accountId, get(current().view)),
	holdArchive: () => request({ type: 'TEST_HOLD_ARCHIVE' }),
	releaseArchive: () => request({ type: 'TEST_RELEASE_ARCHIVE' }),
	selectTransaction: (id: string | null) => current().selectTransaction(id),
	selectKind: (kind: 'income' | 'expense') => current().selectTransactionKind(kind),
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
