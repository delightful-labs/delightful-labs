import { mount, unmount } from 'svelte'
import { get } from 'svelte/store'
import WorkerAccounts from '../../src/lib/components/worker/WorkerAccounts.svelte'
import { createFinanceWorkerClient } from '../../src/lib/runtime/worker/client.js'
import type {
	FinanceWorkerConfiguration,
	WorkerCommandScope
} from '../../src/lib/contracts/worker-application.js'

let worker: Worker | undefined, client: ReturnType<typeof createFinanceWorkerClient> | undefined
let component: ReturnType<typeof mount> | undefined
let scope = ''
let navigationFailure = false,
	navigationReceipt: ReturnType<typeof Promise.withResolvers<void>> | undefined
let navigationCalls = 0
let routeObserver: (() => void) | undefined
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
			location: owner.location,
			recovery: owner.recovery,
			onRestore: owner.restoreIdentity,
			onRetryRecoveryNavigation: owner.retryRecoveryNavigation,
			onRetryWorkspaceNavigation: owner.retryWorkspaceNavigation,
			onSelectWorkspace: (id: string) =>
				routeObserver ? owner.navigateWorkspace(id) : owner.selectWorkspace(id),
			onArchive: owner.archiveAccount,
			onAccountCreation: owner.accountCreationCommand,
			onAccountOrder: owner.accountOrderCommand,
			onClassification: owner.classificationCommand,
			onTransactionEntry: owner.transactionEntryCommand,
			onTransactionEdit: owner.transactionEditCommand,
			onSelectTransaction: (id: string | null, scope: WorkerCommandScope) =>
				routeObserver ? owner.navigateTransaction(id, scope) : owner.selectTransaction(id),
			onLedgerPage: owner.selectLedgerPage,
			onLedgerFilters: owner.setLedgerFilters,
			onSelectAccount: owner.selectAccount,
			onSelectAllAccounts: owner.selectAllAccounts
		}
	})
}
function request(message: unknown) {
	if (!worker) throw new Error('Fixture Worker unavailable')
	const channel = new MessageChannel()
	const result = new Promise<{
		ids?: readonly string[]
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
	followRoutes: () => {
		routeObserver = () => current().observeRoute()
		routeObserver()
	},
	failNextNavigation: () => {
		navigationFailure = true
	},
	holdNavigation: () => {
		navigationReceipt = Promise.withResolvers<void>()
	},
	releaseNavigation: () => {
		navigationReceipt?.resolve()
		navigationReceipt = undefined
	},
	navigationCalls: () => navigationCalls,
	route: (href: string) => {
		history.pushState(null, '', href)
		current().observeLocation()
		routeObserver?.()
	},
	open(configuration: FinanceWorkerConfiguration) {
		scope = configuration.scope
		client = createFinanceWorkerClient(
			configuration,
			async (destination, signal, expectedHref, replace) => {
				navigationCalls += 1
				if (navigationFailure) {
					navigationFailure = false
					throw new Error('Fixture native navigation failure')
				}
				await navigationReceipt?.promise
				if (
					signal.aborted ||
					`${location.pathname}${location.search}${location.hash}` !== expectedHref
				)
					return
				if (replace) history.replaceState(null, '', destination)
				else history.pushState(null, '', destination)
				routeObserver?.()
			},
			() => {
				worker = new Worker(
					new URL('../../src/lib/runtime/worker/application.worker.ts', import.meta.url),
					{ type: 'module' }
				)
				return worker
			}
		)
		attach()
	},
	recoveryReads: () => request({ type: 'TEST_RECOVERY_READS' }),
	state: () => get(current().view),
	seed: (workspaceId: string, accountId: string, name: string, currency: 'USD' | 'TZS' = 'USD') =>
		request({ type: 'TEST_SEED', workspaceId, accountId, name, currency }),
	edit: (accountId: string, name: string) => request({ type: 'TEST_EDIT', accountId, name }),
	seedLedger: (workspaceId: string, accountId: string) =>
		request({ type: 'TEST_SEED_LEDGER', workspaceId, accountId }),
	transactions: (workspaceId: string, authority = false) =>
		request({ type: 'TEST_TRANSACTIONS', workspaceId, authority }),
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
	orderStorage: (namespace: string, key: string, ids?: string[]) =>
		request({ type: 'TEST_ORDER_STORAGE', namespace, key, ...(ids ? { ids } : {}) }),
	badView: () => request({ type: 'TEST_BAD_VIEW' }),
	close: () => current().close(),
	scope: () => scope
}
declare global {
	interface Window {
		financeWorkerReadFixture: typeof fixture
	}
}
document.addEventListener('click', (event) => {
	if (
		!routeObserver ||
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey
	)
		return
	const anchor = event.target instanceof Element ? event.target.closest('a') : null
	if (
		!(anchor instanceof HTMLAnchorElement) ||
		anchor.hasAttribute('download') ||
		(anchor.target && anchor.target !== '_self')
	)
		return
	const url = new URL(anchor.href)
	if (url.origin !== location.origin) return
	event.preventDefault()
	history.pushState(null, '', url)
	current().observeLocation()
	routeObserver()
})
window.financeWorkerReadFixture = fixture
