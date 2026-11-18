import { createWorkspaceNavigationMachine } from '../workspaces/workspace-navigation.js'
import type { WorkspaceNavigate } from '../../contracts/workspace-orchestration-contract.js'
import { sessionRecoveryMachine } from 'delightful-local-first/recovery/coordination'
import type { RecoveryRequest } from 'delightful-local-first/recovery/coordination'
import type { SessionRuntimeIdentityChange } from 'delightful-local-first/session/runtime'
import { createActor, waitFor, type ActorFromLogic } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import {
	createSessionRuntimeMachine,
	createSessionRuntimeConnection,
	type SessionRuntimeObservation,
	type SessionRuntimeResource
} from 'delightful-local-first/session/runtime'
import {
	createFinanceWorkerMachine,
	selectFinanceWorkerView,
	selectFinanceRestorationAdmission,
	selectFinanceNavigationRetry,
	selectFinanceRecoveryReader,
	selectFinanceFormObservations
} from './worker-application.js'
import type {
	FinanceWorkerCapabilities,
	WorkerAccount,
	WorkerAccountRecord,
	WorkerWorkspace,
	WorkerLedgerRecord
} from '../../contracts/worker-application.js'
import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import { creationFixture as workspaceCreationFixture } from '../workspaces/workspace-creation.fixture.js'
import type { InputFrom } from 'xstate'
import type { workspaceInitialization } from '../workspaces/workspace-initialization.js'
import { creationFixture } from '../transactions/transaction-create.fixture.js'
import { createFinanceFormsMachine } from './worker-forms.js'
import { app } from '../../schema.js'
import type {
	WorkerTransactionEntryCommand,
	WorkerAccountCreationCommand
} from '../../contracts/worker-forms.js'
import type { ArchiveObservation } from '../accounts/account-archive-operation.js'

const userId = '10000000-0000-4000-8000-000000000001',
	a = '20000000-0000-4000-8000-000000000001',
	b = '20000000-0000-4000-8000-000000000002'
const row = (name: string): WorkerAccount => ({
	id: '30000000-0000-4000-8000-000000000001',
	name,
	kind: 'cash',
	currency: 'USD'
})
function fixture(initialization?: InputFrom<typeof workspaceInitialization>['db']) {
	const order: string[] = []
	let observed = (_: SessionRuntimeObservation<FinanceWorkerCapabilities>) => {}
	const directory: {
		publish: (rows: Pick<WorkerWorkspace, 'id' | 'name'>[]) => void
		failed: () => void
		release: ReturnType<typeof vi.fn<() => void>>
	}[] = []
	const queries: {
		workspaceId: string
		publish: (rows: WorkerAccount[]) => void
		failed: () => void
		release: ReturnType<typeof vi.fn<() => void>>
	}[] = []
	const memberships: {
		publish: (row: ArchiveObservation['membership']) => void
		failed: () => void
	}[] = []
	const grants: { publish: (rows: ArchiveObservation['grants']) => void; failed: () => void }[] = []
	const transactionDb = creationFixture()
	const ledgers: { publish: (rows: WorkerLedgerRecord[]) => void; failed: () => void }[] = []
	const details: {
		publish: (row: TransactionEntryObservation['transaction']) => void
		release: ReturnType<typeof vi.fn>
	}[] = []
	const recoveryRead = vi.fn(async () => 'fixture phrase')
	const navigate = vi.fn<WorkspaceNavigate>(async () => {})
	const archiveWrite = vi.fn(async (_accountId: string) => {})
	const createWrite = vi.fn(
		async (
			organizationId: string,
			values: { name: string; kind: 'cash' | 'bank' | 'card'; currency: 'USD' | 'TZS' }
		): Promise<WorkerAccountRecord> => ({
			...values,
			organizationId,
			id: crypto.randomUUID(),
			archivedAt: null
		})
	)
	const capabilities: Omit<FinanceWorkerCapabilities, 'createForms'> = {
		observeWorkspaces: (publish, failed) => {
			const release = vi.fn(() => {
				order.push('directory')
			})
			directory.push({
				publish: (rows) => publish(rows.map((row) => ({ ...row, defaultCurrency: 'USD' }))),
				failed,
				release
			})
			return release
		},
		observeAccounts: (workspaceId, publish, failed) => {
			const release = vi.fn(() => {
				order.push('query')
			})
			queries.push({
				workspaceId,
				publish: (rows) =>
					publish(rows.map((row) => ({ ...row, organizationId: workspaceId, archivedAt: null }))),
				failed,
				release
			})
			return release
		},
		observeMembership: (workspaceId, publish, failed) => {
			memberships.push({ publish, failed })
			publish({
				id: '40000000-0000-4000-8000-000000000001',
				organizationId: workspaceId,
				userId,
				role: 'owner',
				accountAccessMode: 'all',
				profileId: null
			})
			return () => {
				order.push('membership')
			}
		},
		observeGrants: (_workspaceId, publish, failed) => {
			grants.push({ publish, failed })
			publish([])
			return () => {
				order.push('grants')
			}
		},
		observeCategories: (organizationId, publish) => {
			publish([
				{
					id: '50000000-0000-4000-8000-000000000001',
					organizationId,
					name: 'Expense',
					kind: 'expense',
					archivedAt: null,
					isSystem: true
				},
				{
					id: '50000000-0000-4000-8000-000000000002',
					organizationId,
					name: 'Income',
					kind: 'income',
					archivedAt: null,
					isSystem: true
				}
			])
			return () => {}
		},
		observeTags: (_id, publish) => {
			publish([])
			return () => {}
		},
		observeTransactions: (_id, publish, failed) => {
			ledgers.push({ publish, failed })
			return () => {
				order.push('ledger')
			}
		},
		observeTransaction: (_workspaceId, _id, publish) => {
			const release = vi.fn()
			details.push({ publish, release })
			return release
		},
		readRecoveryPhrase: recoveryRead,
		archiveAccount: archiveWrite
	}
	const ready = (binding: object): SessionRuntimeObservation<FinanceWorkerCapabilities> => ({
		status: 'ready',
		binding,
		identityId: userId,
		identityKind: 'device',
		localFirst: true,
		capabilities: {
			...capabilities,
			createForms: (observe, _archive, navigate) =>
				createFinanceFormsMachine({
					binding,
					observe,
					create: createWrite,
					archive: archiveWrite,
					navigation: createWorkspaceNavigationMachine({ one: async () => null }, navigate),
					db: transactionDb.db,
					initialization: {
						db: initialization ?? { ...transactionDb.db, getConfig: () => ({ serverUrl: '' }) },
						userId
					}
				})
		}
	})
	const nativeClose = vi.fn(async () => {
		order.push('sdk')
	})
	const changeIdentity = vi.fn(
		async (_change: SessionRuntimeIdentityChange): Promise<'completed' | 'bindingChanged'> =>
			'completed'
	)
	const resource: SessionRuntimeResource<FinanceWorkerCapabilities> = {
		observe: (publish) => {
			observed = publish
			publish(ready({}))
			return () => {
				order.push('observer')
			}
		},
		close: nativeClose,
		changeIdentity
	}
	const open = vi.fn(async () => resource)
	const binding = {},
		brokerIdentity = { scope: 'host', requestId: 'close-receipt' }
	const runtime = createActor(createSessionRuntimeMachine<FinanceWorkerCapabilities>(), {
		input: { binding, capability: { open } }
	})
	const closeAccountStore = vi.fn(async () => {
		order.push('store')
	})
	const closeBroker = vi.fn(async () => {
		order.push('broker')
		return brokerIdentity
	})
	let owner: ActorFromLogic<ReturnType<typeof createFinanceWorkerMachine>> | undefined
	const machine = createFinanceWorkerMachine({
		observeForms: () => selectFinanceFormObservations(owner?.getSnapshot())
	})
	const actor = createActor(machine, {
		input: {
			session: createSessionRuntimeConnection(runtime, binding),
			closeAccountStore,
			closeBroker,
			brokerIdentity,
			navigate
		}
	})
	owner = actor
	const start = async () => {
		actor.start()
		runtime.start()
		await waitFor(actor, (s) => !!s.context.ready)
	}
	const select = (workspaceId: string, revision: number) =>
		actor.send({ type: 'SELECT_CONTEXT', selection: { workspaceId, revision }, kind: 'expense' })
	return {
		actor,
		runtime,
		resource,
		changeIdentity,
		open,
		nativeClose,
		closeAccountStore,
		closeBroker,
		order,
		directory,
		queries,
		memberships,
		grants,
		ledgers,
		details,
		archiveWrite,
		navigate,
		recoveryRead,
		createWrite,
		transactionDb,
		enter: (
			command: WorkerTransactionEntryCommand,
			scope = selectFinanceWorkerView(actor.getSnapshot())
		) =>
			actor.send({
				type: 'TRANSACTION_ENTRY',
				command,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			}),
		selectKind: (kind: 'income' | 'expense', revision: number) =>
			actor.send({
				type: 'SELECT_CONTEXT',
				kind,
				selection: { ...selectFinanceWorkerView(actor.getSnapshot()).selection, revision }
			}),
		create: (
			command: WorkerAccountCreationCommand,
			scope = selectFinanceWorkerView(actor.getSnapshot())
		) =>
			actor.send({
				type: 'ACCOUNT_CREATION',
				command,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			}),
		start,
		select,
		ready,
		publishSession: (value: SessionRuntimeObservation<FinanceWorkerCapabilities>) =>
			observed(value),
		view: () => selectFinanceWorkerView(actor.getSnapshot()),
		stop: () => {
			actor.stop()
			runtime.stop()
		}
	}
}
function last<T>(rows: T[]): T {
	const value = rows.at(-1)
	if (!value) throw new Error('Missing test observation')
	return value
}

describe('Finance worker ownership and selected accounts', () => {
	it('routes an empty directory back to its original entry when a workspace arrives', async () => {
		const f = fixture()
		try {
			await f.start()
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses',
				search: '?page=2',
				hash: '#row',
				revision: 1
			})
			last(f.directory).publish([])
			await vi.waitFor(() =>
				expect(f.navigate).toHaveBeenLastCalledWith(
					'/settings/workspace',
					expect.any(AbortSignal),
					'/expenses?page=2#row',
					true
				)
			)
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/settings/workspace',
				search: '',
				hash: '',
				revision: 2
			})
			expect(f.view().workspaceNavigation?.status).toBe('directory')
			last(f.directory).publish([{ id: a, name: 'A' }])
			await vi.waitFor(() =>
				expect(f.navigate).toHaveBeenLastCalledWith(
					'/expenses?page=2&workspace=' + a + '#row',
					expect.any(AbortSignal),
					'/settings/workspace',
					true
				)
			)
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses',
				search: '?page=2&workspace=' + a,
				hash: '#row',
				revision: 3
			})
			expect(f.view().workspaceNavigation?.status).toBe('scoped')
			expect(f.view().selection.workspaceId).toBe(a)
			last(f.memberships).publish(null)
			expect(f.view().workspaceNavigation).toMatchObject({
				status: 'unavailable',
				showContent: false
			})
		} finally {
			f.stop()
		}
	})
	it('switches through native navigation and refuses old selection commands without optimistic workspace changes', async () => {
		const f = fixture()
		try {
			await f.start()
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses/' + crypto.randomUUID(),
				search: '?workspace=' + a + '&page=3&query=rent',
				hash: '#detail',
				revision: 1
			})
			last(f.directory).publish([
				{ id: a, name: 'A' },
				{ id: b, name: 'B' }
			])
			const scope = f.view()
			f.actor.send({
				type: 'NAVIGATE_WORKSPACE',
				workspaceId: b,
				sessionRevision: scope.sessionRevision,
				selection: scope.selection
			})
			await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledOnce())
			expect(f.navigate).toHaveBeenLastCalledWith(
				'/expenses?workspace=' + b + '&query=rent',
				expect.any(AbortSignal),
				expect.stringContaining('#detail'),
				false
			)
			expect(f.view().selection.workspaceId).toBe(a)
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses',
				search: '?workspace=' + b + '&query=rent',
				hash: '',
				revision: 2
			})
			expect(f.view().workspaceNavigation?.status).toBe('scoped')
			f.actor.send({
				type: 'NAVIGATE_WORKSPACE',
				workspaceId: a,
				sessionRevision: scope.sessionRevision,
				selection: scope.selection
			})
			expect(f.navigate).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('restarts failed subscriptions only after an explicit current routing retry', async () => {
		const f = fixture()
		try {
			await f.start()
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses',
				search: '?workspace=' + a,
				hash: '',
				revision: 1
			})
			last(f.directory).publish([{ id: a, name: 'A' }])
			const scope = f.view(),
				failedDirectory = last(f.directory)
			failedDirectory.failed()
			expect(f.view().workspaceNavigation).toMatchObject({
				status: 'failed',
				showContent: false,
				canRetry: true
			})
			expect(failedDirectory.release).toHaveBeenCalledOnce()
			const count = f.directory.length
			f.actor.send({
				type: 'RETRY_WORKSPACE_NAVIGATION',
				sessionRevision: scope.sessionRevision,
				selection: scope.selection
			})
			expect(f.directory).toHaveLength(count + 1)
			expect(f.view().workspaceNavigation?.status).toBe('waiting')
			last(f.directory).publish([{ id: a, name: 'A' }])
			expect(f.view().workspaceNavigation?.status).toBe('scoped')
			expect(f.navigate).not.toHaveBeenCalled()
		} finally {
			f.stop()
		}
	})
	it.each(['close', 'replace'])(
		'retains an issued workspace navigation receipt before %s',
		async (reason) => {
			const f = fixture(),
				held = Promise.withResolvers<void>()
			f.navigate.mockImplementation(() => held.promise)
			try {
				await f.start()
				f.actor.send({
					type: 'OBSERVE_ROUTE',
					pathname: '/expenses',
					search: '?workspace=' + a,
					hash: '',
					revision: 1
				})
				last(f.directory).publish([
					{ id: a, name: 'A' },
					{ id: b, name: 'B' }
				])
				const scope = f.view(),
					previous = f.actor.getSnapshot().context.forms?.owner
				f.actor.send({
					type: 'NAVIGATE_WORKSPACE',
					workspaceId: b,
					sessionRevision: scope.sessionRevision,
					selection: scope.selection
				})
				await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledOnce())
				if (reason === 'close') f.actor.send({ type: 'CLOSE' })
				else f.publishSession(f.ready({}))
				expect(f.actor.getSnapshot().context.forms?.owner).toBe(previous)
				expect(f.nativeClose).not.toHaveBeenCalled()
				held.resolve()
				if (reason === 'close') {
					await waitFor(f.actor, (s) => s.status === 'done')
					expect(f.nativeClose).toHaveBeenCalledOnce()
				} else {
					await vi.waitFor(() =>
						expect(f.actor.getSnapshot().context.forms?.owner).not.toBe(previous)
					)
					expect(f.nativeClose).not.toHaveBeenCalled()
				}
				expect(f.navigate).toHaveBeenCalledOnce()
			} finally {
				held.resolve()
				f.stop()
			}
		}
	)
	it('reads direct URL filters/pages and changes them only after native history observations', async () => {
		const f = fixture(),
			history = Promise.withResolvers<void>()
		f.navigate.mockImplementationOnce(() => history.promise)
		try {
			await f.start()
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses',
				search: '?workspace=' + a + '&q=rent&page=2&keep=yes',
				hash: '#row',
				revision: 1
			})
			last(f.directory).publish([{ id: a, name: 'A' }])
			last(f.queries).publish([row('Wallet')])
			const records: WorkerLedgerRecord[] = Array.from({ length: 30 }, (_, i) => ({
				id: crypto.randomUUID(),
				organizationId: a,
				accountId: row('Wallet').id,
				categoryId: '50000000-0000-4000-8000-000000000001',
				kind: 'expense',
				currency: 'USD',
				amountMinor: 100,
				bookedOn: '2026-11-18',
				description: 'Rent ' + i,
				memo: null,
				tagNames: []
			}))
			last(f.ledgers).publish(records)
			expect(f.view().ledger).toMatchObject({ page: 2, pageCount: 2, filters: { query: 'rent' } })
			expect(f.view().ledger?.groups.flatMap((g) => g.transactions)).toHaveLength(5)
			const scope = f.view()
			f.actor.send({
				type: 'SET_LEDGER_FILTERS',
				selection: scope.selection,
				sessionRevision: scope.sessionRevision,
				filters: { start: '2026-11-18', end: '', categoryId: '', currency: 'USD', query: 'rent 29' }
			})
			await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledOnce())
			expect(f.navigate).toHaveBeenLastCalledWith(
				'/expenses?workspace=' + a + '&q=rent+29&keep=yes&start=2026-11-18&currency=USD#row',
				expect.any(AbortSignal),
				expect.stringContaining('page=2'),
				true
			)
			expect(f.view().ledger?.page).toBe(2)
			expect(f.view().workspaceNavigation).toMatchObject({ status: 'updating', showContent: true })
			const subscriptions = f.directory.length
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses',
				search: '?workspace=' + a + '&q=rent+29&start=2026-11-18&currency=USD',
				hash: '#row',
				revision: 2
			})
			expect(f.directory).toHaveLength(subscriptions)
			history.resolve()
			await vi.waitFor(() => expect(f.view().workspaceNavigation?.status).toBe('scoped'))
			last(f.queries).publish([row('Wallet')])
			last(f.ledgers).publish(records)
			expect(f.view().ledger).toMatchObject({
				page: 1,
				filters: { query: 'rent 29', currency: 'USD' }
			})
			expect(
				f
					.view()
					.ledger?.groups.flatMap((g) => g.transactions)
					.map((t) => t.description)
			).toEqual(['Rent 29'])
			f.actor.send({
				type: 'SET_LEDGER_PAGE',
				page: 2,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			expect(f.navigate).toHaveBeenCalledOnce()
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses',
				search: '?workspace=' + a + '&q=rent&page=2&keep=yes',
				hash: '#row',
				revision: 3
			})
			last(f.queries).publish([row('Wallet')])
			last(f.ledgers).publish(records)
			expect(f.view().ledger).toMatchObject({ page: 2, filters: { query: 'rent', currency: '' } })
			f.actor.send({
				type: 'SET_LEDGER_PAGE',
				page: 1,
				selection: f.view().selection,
				sessionRevision: f.view().sessionRevision
			})
			await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledTimes(2))
			expect(f.navigate).toHaveBeenLastCalledWith(
				'/expenses?workspace=' + a + '&q=rent&keep=yes#row',
				expect.any(AbortSignal),
				expect.any(String),
				true
			)
		} finally {
			history.resolve()
			f.stop()
		}
	})
	it.each(['0', '-1', '1.5', '1e2', '9007199254740992', 'nope'])(
		'uses page one for an invalid direct page %s',
		async (page) => {
			const f = fixture()
			try {
				await f.start()
				f.actor.send({
					type: 'OBSERVE_ROUTE',
					pathname: '/expenses',
					search: '?workspace=' + a + '&page=' + page,
					hash: '',
					revision: 1
				})
				expect(f.actor.getSnapshot().context.ledgerPage).toBe(1)
			} finally {
				f.stop()
			}
		}
	)
	it('keeps missing balances unknown, projects one exact ledger page, and refuses stale filter/page intents', async () => {
		const f = fixture()
		try {
			await f.start()
			last(f.directory).publish([
				{ id: a, name: 'A' },
				{ id: b, name: 'B' }
			])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			expect(f.view().accounts[0]?.balanceMinor).toBeNull()
			const values: WorkerLedgerRecord[] = Array.from({ length: 30 }, (_, i) => ({
				id: crypto.randomUUID(),
				organizationId: a,
				accountId: row('Wallet').id,
				categoryId: '50000000-0000-4000-8000-000000000001',
				kind: 'expense',
				currency: 'USD',
				amountMinor: Number.MAX_SAFE_INTEGER,
				bookedOn: '2026-11-18',
				description: 'Record ' + i,
				memo: null,
				tagNames: i === 29 ? ['Tail'] : []
			}))
			last(f.ledgers).publish(values)
			expect(f.view().accounts[0]?.balanceMinor).toBe(-270215977642229730n)
			expect(f.view().ledger?.groups.flatMap((g) => g.transactions)).toHaveLength(25)
			expect(f.view().ledger?.groups[0]?.totals).toEqual([['USD', 270215977642229730n]])
			const scope = f.view()
			f.actor.send({
				type: 'SET_LEDGER_PAGE',
				page: 2,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			expect(f.view().ledger?.groups.flatMap((g) => g.transactions)).toHaveLength(5)
			expect(f.view().ledger?.page).toBe(2)
			f.actor.send({
				type: 'SET_LEDGER_FILTERS',
				filters: { start: '', end: '', categoryId: '', currency: '', query: 'tail' },
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			expect(
				f
					.view()
					.ledger?.groups.flatMap((g) => g.transactions)
					.map((t) => t.description)
			).toEqual(['Record 29'])
			expect(f.view().ledger?.page).toBe(1)
			f.select(b, 2)
			expect(f.view().ledger).toBeNull()
			f.actor.send({
				type: 'SET_LEDGER_PAGE',
				page: 2,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			f.actor.send({
				type: 'SET_LEDGER_FILTERS',
				filters: {
					...scope.ledger?.filters,
					start: '',
					end: '',
					categoryId: '',
					currency: '',
					query: 'stale'
				},
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			expect(f.actor.getSnapshot().context.ledgerPage).toBe(1)
			expect(f.actor.getSnapshot().context.ledgerFilters.query).toBe('tail')
		} finally {
			f.stop()
		}
	})
	it('admits only current device-account recovery reads and withdraws them before native close', async () => {
		const f = fixture()
		try {
			await f.start()
			const revision = f.view().sessionRevision
			expect(f.recoveryRead).not.toHaveBeenCalled()
			expect(selectFinanceRecoveryReader(f.actor.getSnapshot(), revision - 1)).toBeUndefined()
			const read = selectFinanceRecoveryReader(f.actor.getSnapshot(), revision)
			expect(await read?.()).toBe('fixture phrase')
			expect(f.recoveryRead).toHaveBeenCalledOnce()
			expect(JSON.stringify(f.view())).not.toContain('fixture phrase')
			f.actor.send({ type: 'CLOSE' })
			expect(selectFinanceRecoveryReader(f.actor.getSnapshot(), revision)).toBeUndefined()
			await waitFor(f.actor, (s) => s.status === 'done')
		} finally {
			f.stop()
		}
	})
	it('keeps known local finance usable while initialization authority is unanswered and drains on close', async () => {
		const initial = workspaceCreationFixture(),
			remote = Promise.withResolvers<never[]>()
		const read = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockReturnValue(remote.promise)
		const f = fixture({
			...initial.db,
			all: read,
			getConfig: () => ({ serverUrl: 'https://unanswered.invalid' })
		})
		try {
			await f.start()
			await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4))
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			expect(f.view().workspaceStartup).toBe('checking')
			expect(f.view().accounts[0]?.name).toBe('Wallet')
			expect(f.view().transactionEntry?.form.canSubmit).toBe(true)
			f.select(b, 2)
			expect(read).toHaveBeenCalledTimes(4)
			expect(initial.beginTransaction).not.toHaveBeenCalled()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).toHaveBeenCalledOnce()
			remote.resolve([])
			await Promise.resolve()
			expect(initial.beginTransaction).not.toHaveBeenCalled()
		} finally {
			f.stop()
		}
	})
	it('retains issued initialization writes until local settlement before closing the SDK', async () => {
		const initial = workspaceCreationFixture(),
			pending = Promise.withResolvers<void>()
		const read = vi.fn().mockResolvedValue([])
		initial.one.mockReset().mockResolvedValue(null)
		initial.wait.mockReturnValue(pending.promise)
		const f = fixture({
			...initial.db,
			all: read,
			getConfig: () => ({ serverUrl: 'https://authority.invalid' })
		})
		try {
			await f.start()
			await vi.waitFor(() => expect(initial.wait).toHaveBeenCalledOnce())
			f.actor.send({ type: 'CLOSE' })
			expect(f.nativeClose).not.toHaveBeenCalled()
			pending.resolve()
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('withdraws selected detail on A → B → A and rejects old edit commands and reports', async () => {
		const f = fixture()
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			const open = (id: string, revision: number) =>
				f.actor.send({
					type: 'SELECT_CONTEXT',
					kind: 'expense',
					transactionId: id,
					selection: { workspaceId: a, revision }
				})
			const firstId = '60000000-0000-4000-8000-000000000001'
			open(firstId, 1)
			last(f.queries).publish([row('Wallet')])
			f.actor.send({
				type: 'SET_LEDGER_PAGE',
				page: 2,
				sessionRevision: f.view().sessionRevision,
				selection: f.view().selection
			})
			open(firstId, 2)
			last(f.queries).publish([row('Wallet')])
			expect(f.actor.getSnapshot().context.ledgerPage).toBe(2)
			const old = last(f.details),
				scope = f.view()
			expect(scope.transactionEdit?.form.readiness).toEqual({ kind: 'blocked', reason: 'loading' })
			old.publish(null)
			expect(f.view().transactionEdit?.form.readiness).toEqual({
				kind: 'blocked',
				reason: 'unavailableReference'
			})
			open('60000000-0000-4000-8000-000000000002', 3)
			open(firstId, 4)
			last(f.queries).publish([row('Wallet')])
			expect(old.release).toHaveBeenCalledOnce()
			old.publish(null)
			expect(f.view().transactionEdit?.form.readiness).toEqual({
				kind: 'blocked',
				reason: 'loading'
			})
			f.actor.send({
				type: 'TRANSACTION_EDIT',
				command: { type: 'SUBMIT', values: {} },
				sessionRevision: scope.sessionRevision,
				selection: scope.selection
			})
			expect(f.transactionDb.beginTransaction).not.toHaveBeenCalled()
			last(f.details).publish(null)
			expect(f.view().transactionEdit?.initialTransaction).toBeNull()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(last(f.details).release).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it.each(['expense', 'income'])(
		'reuses native transaction policy and staged persistence for %s',
		async (kind) => {
			const f = fixture()
			try {
				await f.start()
				last(f.directory).publish([{ id: a, name: 'A' }])
				f.select(a, 1)
				if (kind === 'income') f.selectKind('income', 2)
				last(f.queries).publish([row('Wallet')])
				expect(f.view().transactionEntry?.form.canSubmit).toBe(true)
				f.enter({
					type: 'SUBMIT',
					values: {
						accountId: row('Wallet').id,
						categoryId:
							kind === 'expense'
								? '50000000-0000-4000-8000-000000000001'
								: '50000000-0000-4000-8000-000000000002',
						amount: '10.23',
						bookedOn: '2026-11-18',
						tags: []
					}
				})
				await vi.waitFor(() => expect(f.view().transactionEntry?.form.content.kind).toBe('success'))
				expect(f.transactionDb.insert).toHaveBeenCalledWith(
					app.transactions,
					expect.objectContaining({
						kind,
						amountMinor: 1023,
						currency: 'USD',
						organizationId: a,
						accountId: row('Wallet').id,
						source: 'manual'
					}),
					expect.anything()
				)
				expect(f.transactionDb.commit).toHaveBeenCalledOnce()
				expect(structuredClone(f.view())).toEqual(f.view())
			} finally {
				f.stop()
			}
		}
	)
	it.each(['amount', 'account'])('refuses invalid transaction %s before staging', async (field) => {
		const f = fixture()
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			f.enter({
				type: 'SUBMIT',
				values: {
					accountId: field === 'account' ? crypto.randomUUID() : row('Wallet').id,
					categoryId: '50000000-0000-4000-8000-000000000001',
					amount: field === 'amount' ? '-1' : '10.23',
					bookedOn: '2026-11-18',
					tags: []
				}
			})
			await vi.waitFor(() =>
				expect(f.view().transactionEntry?.form.feedback).toMatchObject({
					kind: 'result',
					result: { outcome: 'invalid' }
				})
			)
			expect(f.transactionDb.commit).not.toHaveBeenCalled()
			expect(f.transactionDb.insert).not.toHaveBeenCalled()
		} finally {
			f.stop()
		}
	})
	it('refuses stale transaction commands after expense → income → expense', async () => {
		const f = fixture()
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			const old = f.view()
			f.selectKind('income', 2)
			last(f.queries).publish([row('Wallet')])
			f.selectKind('expense', 3)
			last(f.queries).publish([row('Wallet')])
			const command = {
				type: 'SUBMIT',
				values: {
					accountId: row('Wallet').id,
					categoryId: '50000000-0000-4000-8000-000000000001',
					amount: '10.23',
					bookedOn: '2026-11-18',
					tags: []
				}
			} satisfies WorkerTransactionEntryCommand
			f.enter(command, old)
			expect(f.transactionDb.insert).not.toHaveBeenCalled()
			f.enter(command)
			await vi.waitFor(() => expect(f.view().transactionEntry?.form.content.kind).toBe('success'))
			expect(f.transactionDb.commit).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('keeps the original transaction through local settlement before host shutdown', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.transactionDb.wait.mockImplementation(() => held.promise)
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			f.enter({
				type: 'SUBMIT',
				values: {
					accountId: row('Wallet').id,
					categoryId: '50000000-0000-4000-8000-000000000001',
					amount: '10.23',
					bookedOn: '2026-11-18',
					tags: []
				}
			})
			await vi.waitFor(() => expect(f.transactionDb.wait).toHaveBeenCalledOnce())
			f.actor.send({ type: 'CLOSE' })
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			held.resolve()
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).toHaveBeenCalledOnce()
			expect(f.transactionDb.commit).toHaveBeenCalledOnce()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('drains a pending transaction on SDK replacement without replay or old feedback', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.transactionDb.wait.mockImplementation(() => held.promise)
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			f.enter({
				type: 'SUBMIT',
				values: {
					accountId: row('Wallet').id,
					categoryId: '50000000-0000-4000-8000-000000000001',
					amount: '10.23',
					bookedOn: '2026-11-18',
					tags: []
				}
			})
			await vi.waitFor(() => expect(f.transactionDb.wait).toHaveBeenCalledOnce())
			f.publishSession(f.ready({}))
			expect(f.view().transactionEntry).toBeNull()
			expect(f.queries).toHaveLength(1)
			held.resolve()
			await vi.waitFor(() => expect(f.queries).toHaveLength(2))
			last(f.directory).publish([{ id: a, name: 'A' }])
			last(f.queries).publish([row('Wallet')])
			expect(f.view().transactionEntry?.form.content.kind).toBe('fields')
			expect(f.view().transactionEntry?.form.feedback.kind).toBe('none')
			expect(f.transactionDb.commit).toHaveBeenCalledOnce()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('validates creation in the existing worker form and publishes a cloneable success', async () => {
		const f = fixture()
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([])
			expect(f.view().accountCreation?.canOpen).toBe(true)
			f.create({ type: 'SUBMIT', values: { name: '  Wallet  ', kind: 'cash', currency: 'TZS' } })
			await vi.waitFor(() => expect(f.view().accountCreation?.content.kind).toBe('success'))
			expect(f.createWrite).toHaveBeenCalledExactlyOnceWith(a, {
				name: 'Wallet',
				kind: 'cash',
				currency: 'TZS'
			})
			expect(f.view().accountCreation?.content).toMatchObject({
				kind: 'success',
				value: { name: 'Wallet', currency: 'TZS' }
			})
			expect(structuredClone(f.view())).toEqual(f.view())
		} finally {
			f.stop()
		}
	})
	it.each(['invalid', 'duplicate', 'readOnly'])(
		'refuses %s creation before native writes',
		async (reason) => {
			const f = fixture()
			try {
				await f.start()
				last(f.directory).publish([{ id: a, name: 'A' }])
				f.select(a, 1)
				last(f.queries).publish([row('Wallet')])
				if (reason === 'readOnly')
					last(f.memberships).publish({
						id: crypto.randomUUID(),
						organizationId: a,
						userId,
						role: 'viewer',
						accountAccessMode: 'all',
						profileId: null
					})
				f.create({
					type: 'SUBMIT',
					values: { name: reason === 'invalid' ? '' : 'Wallet', kind: 'cash', currency: 'USD' }
				})
				await vi.waitFor(() => expect(f.view().accountCreation?.activity.kind).toBe('idle'))
				if (reason === 'readOnly') {
					expect(f.view().accountCreation?.readiness).toEqual({
						kind: 'blocked',
						reason: 'readOnly'
					})
					expect(f.view().accountCreation?.canSubmit).toBe(false)
				} else {
					await vi.waitFor(() => expect(f.view().accountCreation?.feedback.kind).toBe('result'))
					expect(f.view().accountCreation?.feedback).toMatchObject({
						kind: 'result',
						result: { outcome: reason === 'invalid' ? 'invalid' : 'unavailable' }
					})
				}
				expect(f.createWrite).not.toHaveBeenCalled()
			} finally {
				f.stop()
			}
		}
	)
	it('refuses old session commands even when the replacement identity and workspace IDs match', async () => {
		const f = fixture()
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			const oldScope = f.view()
			f.publishSession(f.ready({}))
			await vi.waitFor(() => expect(f.queries).toHaveLength(2))
			last(f.directory).publish([{ id: a, name: 'A' }])
			last(f.queries).publish([row('Wallet')])
			expect(f.view().sessionRevision).toBeGreaterThan(oldScope.sessionRevision)
			f.create({ type: 'SUBMIT', values: { name: 'New', kind: 'cash', currency: 'USD' } }, oldScope)
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				accountId: row('Wallet').id,
				selection: oldScope.selection,
				sessionRevision: oldScope.sessionRevision
			})
			expect(f.createWrite).not.toHaveBeenCalled()
			expect(f.archiveWrite).not.toHaveBeenCalled()
			f.create({ type: 'SUBMIT', values: { name: 'New', kind: 'cash', currency: 'USD' } })
			await vi.waitFor(() => expect(f.createWrite).toHaveBeenCalledOnce())
		} finally {
			f.stop()
		}
	})
	it('drains an admitted creation before replacing its SDK-bound form owner and hides old results', async () => {
		const f = fixture(),
			held = Promise.withResolvers<Awaited<ReturnType<typeof f.createWrite>>>()
		f.createWrite.mockImplementationOnce(() => held.promise)
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([])
			const owner = f.actor.getSnapshot().context.forms?.owner
			f.create({ type: 'SUBMIT', values: { name: 'Old save', kind: 'cash', currency: 'USD' } })
			await vi.waitFor(() => expect(f.createWrite).toHaveBeenCalledOnce())
			f.publishSession(f.ready({}))
			expect(f.actor.getSnapshot().matches('retiringForms')).toBe(true)
			expect(f.actor.getSnapshot().context.forms?.owner).toBe(owner)
			expect(f.view().accountCreation).toBeNull()
			expect(f.queries).toHaveLength(1)
			held.resolve({ ...row('Old save'), organizationId: a, archivedAt: null })
			await vi.waitFor(() => expect(f.queries).toHaveLength(2))
			last(f.directory).publish([{ id: a, name: 'A' }])
			last(f.queries).publish([])
			expect(f.actor.getSnapshot().context.forms?.owner).not.toBe(owner)
			expect(f.view().accountCreation?.content.kind).toBe('fields')
			expect(f.view().accountCreation?.feedback.kind).toBe('none')
			expect(f.createWrite).toHaveBeenCalledOnce()
		} finally {
			held.resolve({ ...row('Old save'), organizationId: a, archivedAt: null })
			f.stop()
		}
	})
	it('waits for both archive and creation settlement before closing the SDK', async () => {
		const f = fixture(),
			archived = Promise.withResolvers<void>(),
			created = Promise.withResolvers<Awaited<ReturnType<typeof f.createWrite>>>()
		f.archiveWrite.mockImplementation(() => archived.promise)
		f.createWrite.mockImplementation(() => created.promise)
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				accountId: row('Wallet').id,
				selection: f.view().selection,
				sessionRevision: f.view().sessionRevision
			})
			f.create({ type: 'SUBMIT', values: { name: 'New save', kind: 'cash', currency: 'USD' } })
			await vi.waitFor(() => expect(f.createWrite).toHaveBeenCalledOnce())
			f.actor.send({ type: 'CLOSE' })
			expect(f.nativeClose).not.toHaveBeenCalled()
			archived.resolve()
			await vi.waitFor(() =>
				expect(
					f.actor
						.getSnapshot()
						.context.forms?.owner.getSnapshot()
						.matches({ closing: { archive: 'closed' } })
				).toBe(true)
			)
			expect(f.nativeClose).not.toHaveBeenCalled()
			created.resolve({ ...row('New save'), organizationId: a, archivedAt: null })
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).toHaveBeenCalledOnce()
			expect(f.createWrite).toHaveBeenCalledOnce()
		} finally {
			archived.resolve()
			created.resolve({ ...row('New save'), organizationId: a, archivedAt: null })
			f.stop()
		}
	})
	it('publishes plain fields, starts only the selected query and rejects retired A → B → A reports', async () => {
		const f = fixture()
		try {
			await f.start()
			expect(f.queries).toHaveLength(0)
			expect(f.view().status).toBe('loading')
			last(f.directory).publish([
				{ id: a, name: 'A' },
				{ id: b, name: 'B' }
			])
			f.select(a, 1)
			last(f.directory).publish([
				{ id: a, name: 'A' },
				{ id: b, name: 'B' }
			])
			const first = last(f.queries),
				firstBinding = f.actor.getSnapshot().context.readBinding
			first.publish([row('first A')])
			expect(f.view().accounts).toMatchObject([row('first A')])
			f.select(b, 2)
			expect(f.view().accounts).toEqual([])
			const second = last(f.queries)
			second.publish([row('B')])
			first.publish([row('late first A')])
			if (!firstBinding) throw new Error('Missing retired binding')
			f.actor.getSnapshot().children.queries?.send({
				type: 'ACCOUNTS',
				binding: firstBinding,
				rows: [{ ...row('stale report'), organizationId: a, archivedAt: null }]
			})
			expect(f.view().accounts).toMatchObject([row('B')])
			f.select(a, 3)
			last(f.queries).publish([row('new A')])
			first.publish([row('original A')])
			expect(f.view().accounts).toMatchObject([row('new A')])
			f.select(b, 2)
			expect(f.queries).toHaveLength(3)
			expect(first.release).toHaveBeenCalledOnce()
			expect(second.release).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('withdraws data for identity replacement even when the new identity ID is the same', async () => {
		const f = fixture()
		try {
			await f.start()
			f.select(a, 1)
			const before = last(f.queries),
				oldDirectory = last(f.directory)
			before.publish([row('old')])
			f.publishSession({ status: 'transitioning' })
			expect(f.view().accounts).toEqual([])
			f.publishSession(f.ready({}))
			before.publish([row('retired')])
			oldDirectory.publish([{ id: a, name: 'retired directory' }])
			expect(f.view().workspaces).toBeNull()
			expect(f.view().accounts).toEqual([])
			last(f.queries).publish([row('current')])
			last(f.directory).publish([{ id: a, name: 'current workspace' }])
			expect(f.view().accounts).toMatchObject([row('current')])
			expect(before.release).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('withdraws a failed read and supports a new selected query without replaying any write', async () => {
		const f = fixture()
		try {
			await f.start()
			f.select(a, 1)
			const query = last(f.queries)
			query.publish([row('visible')])
			query.failed()
			expect(f.view()).toMatchObject({ status: 'failed', accounts: [] })
			expect(query.release).toHaveBeenCalledOnce()
			f.select(b, 2)
			last(f.directory).publish([{ id: b, name: 'B' }])
			last(f.queries).publish([])
			expect(f.view()).toMatchObject({
				status: 'ready',
				accounts: [],
				selection: { workspaceId: b, revision: 2 }
			})
			expect(f.open).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('unsubscribes before SDK close, retains a held close, and closes storage/broker once in order', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.nativeClose.mockImplementation(async () => {
			f.order.push('sdk')
			await held.promise
		})
		try {
			await f.start()
			f.select(a, 1)
			f.actor.send({ type: 'CLOSE' })
			f.actor.send({ type: 'CLOSE' })
			await vi.waitFor(() => expect(f.nativeClose).toHaveBeenCalledOnce())
			expect(f.order.indexOf('query')).toBeLessThan(f.order.indexOf('sdk'))
			expect(f.order.indexOf('directory')).toBeLessThan(f.order.indexOf('sdk'))
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().output).toBeUndefined()
			held.resolve()
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.order.slice(-3)).toEqual(['sdk', 'store', 'broker'])
			expect(f.closeBroker).toHaveBeenCalledOnce()
			expect(f.view().status).toBe('closed')
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('waits for late native acquisition and closes it without starting queries', async () => {
		const f = fixture(),
			acquired = Promise.withResolvers<SessionRuntimeResource<FinanceWorkerCapabilities>>()
		f.open.mockImplementation(() => acquired.promise)
		try {
			f.actor.start()
			f.runtime.start()
			f.actor.send({ type: 'CLOSE' })
			expect(f.actor.getSnapshot().output).toBeUndefined()
			acquired.resolve(f.resource)
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.directory).toHaveLength(0)
			expect(f.queries).toHaveLength(0)
			expect(f.nativeClose).toHaveBeenCalledOnce()
		} finally {
			acquired.resolve(f.resource)
			f.stop()
		}
	})
	it.each(['sdk', 'store', 'broker', 'receipt'])(
		'refuses clean closure after %s failure',
		async (fault) => {
			const f = fixture()
			if (fault === 'sdk')
				f.nativeClose.mockRejectedValueOnce(new Error('Synthetic SDK close failure'))
			if (fault === 'store')
				f.closeAccountStore.mockRejectedValueOnce(new Error('Synthetic store close failure'))
			if (fault === 'broker')
				f.closeBroker.mockRejectedValueOnce(new Error('Synthetic broker close failure'))
			if (fault === 'receipt')
				f.closeBroker.mockResolvedValueOnce({ scope: 'other host', requestId: 'wrong receipt' })
			try {
				await f.start()
				f.actor.send({ type: 'CLOSE' })
				await waitFor(f.actor, (s) => s.matches('closeFailed'))
				expect(f.actor.getSnapshot().output).toBeUndefined()
				if (fault === 'sdk') expect(f.closeAccountStore).not.toHaveBeenCalled()
				if (fault === 'store') expect(f.closeBroker).not.toHaveBeenCalled()
			} finally {
				f.stop()
			}
		}
	)
	it('uses the existing archive workflow and drains an issued save before SDK teardown', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.archiveWrite.mockImplementation(async () => {
			f.order.push('write')
			await held.promise
			f.order.push('settled')
		})
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			expect(f.view().accounts[0]?.archiveAction).toBe('available')
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('Wallet').id,
				selection: { workspaceId: a, revision: 1 }
			})
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('Wallet').id,
				selection: { workspaceId: a, revision: 1 }
			})
			expect(f.archiveWrite).toHaveBeenCalledOnce()
			expect(f.view().accounts[0]?.archiveAction).toBe('archiving')
			f.actor.send({ type: 'CLOSE' })
			f.actor.send({ type: 'CLOSE' })
			expect(f.view().status).toBe('closing')
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			held.resolve()
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.order.indexOf('settled')).toBeLessThan(f.order.indexOf('sdk'))
			expect(f.archiveWrite).toHaveBeenCalledOnce()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('keeps an old workspace save alive across A → B → A without publishing its old feedback or replaying it', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.archiveWrite.mockImplementation(() => held.promise)
		try {
			await f.start()
			last(f.directory).publish([
				{ id: a, name: 'A' },
				{ id: b, name: 'B' }
			])
			f.select(a, 1)
			last(f.queries).publish([row('Original A')])
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('Original A').id,
				selection: { workspaceId: a, revision: 1 }
			})
			f.select(b, 2)
			last(f.queries).publish([row('B')])
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('B').id,
				selection: { workspaceId: a, revision: 1 }
			})
			f.select(a, 3)
			last(f.queries).publish([row('New A')])
			expect(f.view().archiveFeedback).toBeNull()
			expect(f.nativeClose).not.toHaveBeenCalled()
			held.resolve()
			await vi.waitFor(() => expect(f.view().accounts[0]?.archiveAction).toBe('available'))
			expect(f.view().archiveFeedback).toBeNull()
			expect(f.archiveWrite).toHaveBeenCalledOnce()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('drains an issued archive before replacing the SDK-bound financial group', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.archiveWrite.mockImplementation(() => held.promise)
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			const previous = f.actor.getSnapshot().context.forms?.owner
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('Wallet').id,
				selection: { workspaceId: a, revision: 1 }
			})
			expect(f.archiveWrite).toHaveBeenCalledOnce()
			f.publishSession(f.ready({}))
			expect(f.view().accounts).toEqual([])
			expect(f.view().archiveFeedback).toBeNull()
			expect(f.actor.getSnapshot().context.forms?.owner).toBe(previous)
			expect(f.queries).toHaveLength(1)
			held.resolve()
			await vi.waitFor(() => expect(f.queries).toHaveLength(2))
			expect(f.actor.getSnapshot().context.forms?.owner).not.toBe(previous)
			last(f.directory).publish([{ id: a, name: 'A' }])
			last(f.queries).publish([row('Wallet')])
			expect(f.view().accounts[0]?.archiveAction).toBe('available')
			expect(f.view().archiveFeedback).toBeNull()
			expect(f.archiveWrite).toHaveBeenCalledOnce()
			expect(f.nativeClose).not.toHaveBeenCalled()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('uses actual membership and scoped grants rather than the presence of a rendered row as archive permission', async () => {
		const f = fixture()
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			const owner = {
				id: '40000000-0000-4000-8000-000000000001',
				organizationId: a,
				userId,
				role: 'owner',
				accountAccessMode: 'all',
				profileId: null
			} satisfies NonNullable<ArchiveObservation['membership']>
			last(f.memberships).publish({ ...owner, role: 'viewer' })
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('Wallet').id,
				selection: { workspaceId: a, revision: 1 }
			})
			expect(f.view().accounts[0]?.archiveAction).toBe('unavailable')
			expect(f.archiveWrite).not.toHaveBeenCalled()
			last(f.memberships).publish({ ...owner, role: 'member', accountAccessMode: 'selected' })
			last(f.grants).publish([
				{ organizationId: b, userId, accountId: row('Wallet').id, access: 'write' }
			])
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('Wallet').id,
				selection: { workspaceId: a, revision: 1 }
			})
			expect(f.archiveWrite).not.toHaveBeenCalled()
			last(f.grants).publish([
				{ organizationId: a, userId, accountId: row('Wallet').id, access: 'write' }
			])
			expect(f.view().accounts[0]?.archiveAction).toBe('available')
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('Wallet').id,
				selection: { workspaceId: a, revision: 0 }
			})
			expect(f.archiveWrite).not.toHaveBeenCalled()
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('Wallet').id,
				selection: { workspaceId: a, revision: 1 }
			})
			await vi.waitFor(() => expect(f.view().archiveFeedback?.outcome).toBe('succeeded'))
			expect(f.archiveWrite).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('reports a rejected archive once and never retries it automatically', async () => {
		const f = fixture()
		f.archiveWrite.mockRejectedValueOnce(new Error('Synthetic native write refusal'))
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				sessionRevision: f.view().sessionRevision,
				accountId: row('Wallet').id,
				selection: { workspaceId: a, revision: 1 }
			})
			await vi.waitFor(() =>
				expect(f.view().archiveFeedback).toEqual({
					outcome: 'failed',
					settlement: 'rejected',
					name: 'Wallet'
				})
			)
			expect(f.archiveWrite).toHaveBeenCalledOnce()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.archiveWrite).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('refuses native close when the archive owner completes without the host requesting a drain', async () => {
		const f = fixture()
		try {
			await f.start()
			f.actor
				.getSnapshot()
				.context.forms?.owner.getSnapshot()
				.children.archive?.send({ type: 'SHUTDOWN' })
			await waitFor(f.actor, (snapshot) => snapshot.matches('drainFailed'))
			f.actor.send({ type: 'CLOSE' })
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().output).toBeUndefined()
		} finally {
			f.stop()
		}
	})
	it('reports failed native acquisition without starting queries and can release the unopened host', async () => {
		const f = fixture()
		f.open.mockRejectedValueOnce(new Error('Synthetic native acquisition failure'))
		try {
			f.actor.start()
			f.runtime.start()
			await waitFor(f.actor, (s) => s.matches('failed'))
			expect(f.view()).toMatchObject({ status: 'failed', accounts: [], workspaces: null })
			expect(f.queries).toHaveLength(0)
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.order).toEqual(['store', 'broker'])
		} finally {
			f.stop()
		}
	})
	it('does not acknowledge clean close when query disposal throws', async () => {
		const f = fixture()
		try {
			await f.start()
			f.select(a, 1)
			last(f.queries).release.mockImplementation(() => {
				throw new Error('Synthetic query disposal failure')
			})
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (s) => s.matches('cleanupFailed'))
			expect(f.actor.getSnapshot().output).toBeUndefined()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			expect(f.closeBroker).not.toHaveBeenCalled()
			f.actor.send({ type: 'CLOSE' })
			expect(f.actor.getSnapshot().matches('cleanupFailed')).toBe(true)
		} finally {
			f.stop()
		}
	})
	it('withdraws retained rows when the host is forcibly stopped without fabricating native close', async () => {
		const f = fixture()
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('visible')])
			f.actor.stop()
			expect(f.view()).toMatchObject({
				status: 'failed',
				accounts: [],
				workspaces: null,
				identityId: null
			})
			expect(f.actor.getSnapshot().output).toBeUndefined()
			expect(f.nativeClose).not.toHaveBeenCalled()
		} finally {
			f.stop()
		}
	})
	it('does not report clean closure when its session owner is forcibly stopped', async () => {
		const f = fixture()
		try {
			await f.start()
			f.runtime.stop()
			await waitFor(f.actor, (s) => s.matches('failed'))
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (s) => s.matches('closeFailed'))
			expect(f.actor.getSnapshot().output).toBeUndefined()
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
		} finally {
			f.stop()
		}
	})
})

function restoreFixture(
	f: ReturnType<typeof fixture>,
	parse = vi.fn(async (_phrase: string) => 'synthetic-secret'),
	navigate = vi.fn(async (_destination: string) => {}),
	request: RecoveryRequest = {
		kind: 'restore',
		phrase: 'private input',
		origin: '/from',
		destination: '/to'
	}
) {
	if (!f.actor.getSnapshot().context.href) f.actor.send({ type: 'OBSERVE_LOCATION', href: '/from' })
	const select =
		request.kind === 'restore' ? selectFinanceRestorationAdmission : selectFinanceNavigationRetry
	const admitted = select(f.actor.getSnapshot(), f.view().sessionRevision)
	if (!admitted) throw new Error('Restoration not admitted')
	const { session, scope } = admitted
	const actor = createActor(sessionRecoveryMachine, {
		input: {
			attempt: scope.attempt,
			request,
			session,
			navigate,
			readHref: () => f.actor.getSnapshot().context.href ?? '/from',
			reportTo: f.actor,
			restorationBinding: {
				binding: scope.binding,
				invalidate: () => {},
				capability: {
					runtime: session,
					parsePhrase: parse,
					isCurrentBinding: (binding) =>
						binding === session.binding && session.view.get().stage === 'active',
					readIdentity: async () => {
						const observation = session.view.get().observation
						return observation?.status === 'ready'
							? { kind: 'ready', identityId: observation.identityId }
							: { kind: 'unavailable' }
					}
				}
			}
		}
	})
	actor.subscribe({
		complete: () => {
			const result = actor.getSnapshot().output
			if (result)
				f.actor.send({ type: 'RESTORATION_FINISHED', scope, result, view: session.view.get() })
			else f.actor.send({ type: 'RESTORATION_FAILED', ...scope })
		}
	})
	f.actor.send({
		type: 'REGISTER_RESTORATION',
		scope,
		owner: actor,
		operation: request.kind,
		sessionRevision: f.view().sessionRevision
	})
	actor.start()
	return { actor, scope, parse, navigate }
}
describe('worker restoration and financial drain', () => {
	it('rejects an invalid phrase without replacing finance or issuing SDK mutation', async () => {
		const f = fixture()
		try {
			await f.start()
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			const previous = f.actor.getSnapshot().context.forms?.owner
			const r = restoreFixture(
				f,
				vi.fn(async () => {
					throw new Error('Invalid phrase')
				})
			)
			await waitFor(r.actor, (s) => s.status === 'done')
			expect(f.view().identityRestore).toMatchObject({ busy: false, error: true })
			expect(f.changeIdentity).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().context.forms?.owner).toBe(previous)
			expect(f.queries).toHaveLength(1)
			expect(f.view().accounts[0]?.name).toBe('Wallet')
		} finally {
			f.stop()
		}
	})
	it('waits for an issued archive, restores once and replaces finance without old feedback', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.archiveWrite.mockImplementation(() => held.promise)
		try {
			await f.start()
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			const previous = f.actor.getSnapshot().context.forms?.owner,
				revision = f.view().sessionRevision
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				accountId: row('Wallet').id,
				sessionRevision: revision,
				selection: f.view().selection
			})
			const r = restoreFixture(f)
			await waitFor(f.actor, (s) => s.matches('restoring'))
			expect(f.view().identityRestore.busy).toBe(true)
			expect(f.view().accounts).toEqual([])
			expect(f.changeIdentity).not.toHaveBeenCalled()
			expect(f.view().sessionRevision).toBeGreaterThan(revision)
			held.resolve()
			await waitFor(r.actor, (s) => s.status === 'done')
			await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
			expect(f.changeIdentity).toHaveBeenCalledOnce()
			expect(f.archiveWrite).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().context.forms?.owner).not.toBe(previous)
			expect(f.view().identityRestore).toMatchObject({ busy: false, error: false })
			expect(f.view().archiveFeedback).toBeNull()
			expect(f.view().selection.workspaceId).toBeNull()
			expect(
				JSON.stringify(f.view(), (_key, value: unknown) =>
					typeof value === 'bigint' ? String(value) : value
				)
			).not.toContain('synthetic-secret')
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('resumes with a new financial group after a same-binding SDK failure without retrying', async () => {
		const f = fixture()
		f.changeIdentity.mockRejectedValueOnce(new Error('SDK refused restore'))
		try {
			await f.start()
			const previous = f.actor.getSnapshot().context.forms?.owner
			const r = restoreFixture(f)
			await waitFor(r.actor, (s) => s.status === 'done')
			await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
			expect(f.actor.getSnapshot().context.forms?.owner).not.toBe(previous)
			expect(f.view().identityRestore).toMatchObject({ busy: false, error: true })
			expect(f.changeIdentity).toHaveBeenCalledOnce()
			f.actor.send({
				type: 'RESTORATION_FINISHED',
				scope: r.scope,
				result: { mutation: 'settled', outcome: 'restored' },
				view: f.actor.getSnapshot().context.session.view.get()
			})
			expect(f.view().identityRestore.error).toBe(true)
			expect(f.changeIdentity).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('closes during preparation without issuing restoration and waits for the financial receipt', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.archiveWrite.mockImplementation(() => held.promise)
		try {
			await f.start()
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				accountId: row('Wallet').id,
				sessionRevision: f.view().sessionRevision,
				selection: f.view().selection
			})
			const r = restoreFixture(f)
			await waitFor(f.actor, (s) => s.matches('restoring'))
			f.actor.send({ type: 'CLOSE' })
			expect(f.changeIdentity).not.toHaveBeenCalled()
			expect(f.nativeClose).not.toHaveBeenCalled()
			held.resolve()
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(r.actor.getSnapshot().output).toMatchObject({
				outcome: 'closed',
				mutation: 'notStarted'
			})
			expect(f.nativeClose).toHaveBeenCalledOnce()
			expect(f.changeIdentity).not.toHaveBeenCalled()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('finishes a cancelled preparation drain before resuming without issuing native restore', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.archiveWrite.mockImplementation(() => held.promise)
		try {
			await f.start()
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			f.actor.send({
				type: 'ARCHIVE_ACCOUNT',
				accountId: row('Wallet').id,
				sessionRevision: f.view().sessionRevision,
				selection: f.view().selection
			})
			const r = restoreFixture(f)
			await waitFor(f.actor, (s) => s.matches('restoring'))
			r.actor.send({ type: 'SHUTDOWN' })
			await waitFor(r.actor, (s) => s.status === 'done')
			expect(f.actor.getSnapshot().matches('restoring')).toBe(true)
			expect(f.changeIdentity).not.toHaveBeenCalled()
			f.actor.send({
				type: 'SELECT_CONTEXT',
				selection: { workspaceId: b, revision: 2 },
				kind: 'income'
			})
			held.resolve()
			await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
			expect(f.view().selection).toEqual({ workspaceId: null, revision: 2 })
			expect(f.view().identityRestore).toMatchObject({ busy: false, error: false, canSubmit: true })
			expect(f.changeIdentity).not.toHaveBeenCalled()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('does not cancel signed-out validation on a repeated signed-out observation', async () => {
		const f = fixture(),
			parsed = Promise.withResolvers<string>()
		try {
			await f.start()
			const signedOut = {
				status: 'signed-out',
				binding: {}
			} satisfies SessionRuntimeObservation<FinanceWorkerCapabilities>
			f.publishSession(signedOut)
			await waitFor(f.actor, (s) => s.matches({ running: 'waiting' }))
			const r = restoreFixture(
				f,
				vi.fn(() => parsed.promise)
			)
			f.publishSession(signedOut)
			expect(r.actor.getSnapshot().status).toBe('active')
			expect(f.view().identityRestore.busy).toBe(true)
			r.actor.send({ type: 'SHUTDOWN' })
			await waitFor(r.actor, (s) => s.status === 'done')
			expect(f.changeIdentity).not.toHaveBeenCalled()
			expect(f.view().identityRestore.canSubmit).toBe(true)
		} finally {
			parsed.resolve('late-secret')
			f.stop()
		}
	})
	it('cancels validation if the SDK binding changes before preparation', async () => {
		const f = fixture(),
			parsed = Promise.withResolvers<string>()
		try {
			await f.start()
			const r = restoreFixture(
				f,
				vi.fn(() => parsed.promise)
			)
			expect(f.view().identityRestore.busy).toBe(true)
			f.publishSession(f.ready({}))
			await waitFor(r.actor, (s) => s.status === 'done')
			await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
			parsed.resolve('late-secret')
			expect(f.view().identityRestore).toMatchObject({ busy: false, error: false })
			expect(f.changeIdentity).not.toHaveBeenCalled()
		} finally {
			parsed.resolve('late-secret')
			f.stop()
		}
	})
	it('retains an issued native restore across close before releasing the SDK and storage', async () => {
		const f = fixture(),
			held = Promise.withResolvers<'completed'>()
		f.changeIdentity.mockImplementation(() => held.promise)
		try {
			await f.start()
			const r = restoreFixture(f)
			await vi.waitFor(() => expect(f.changeIdentity).toHaveBeenCalledOnce())
			f.actor.send({ type: 'CLOSE' })
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			held.resolve('completed')
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).toHaveBeenCalledOnce()
			expect(f.closeAccountStore).toHaveBeenCalledOnce()
			expect(r.actor.getSnapshot().output?.outcome).toBe('closed')
			expect(f.view().status).toBe('closed')
		} finally {
			held.resolve('completed')
			f.stop()
		}
	})
})

describe('worker recovery native navigation ownership', () => {
	it('retries a failed redirect without repeating restoration', async () => {
		const f = fixture(),
			navigate = vi
				.fn(async (_destination: string) => {})
				.mockRejectedValueOnce(new Error('Window navigation failed'))
		try {
			await f.start()
			const first = restoreFixture(f, undefined, navigate)
			await waitFor(first.actor, (s) => s.status === 'done')
			await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
			expect(f.view().identityRestore).toMatchObject({
				busy: false,
				error: false,
				navigationError: true,
				canRetryNavigation: true
			})
			const retry = selectFinanceNavigationRetry(f.actor.getSnapshot(), f.view().sessionRevision)
			if (!retry) throw new Error('Navigation retry unavailable')
			const next = restoreFixture(f, undefined, navigate, { kind: 'navigate', ...retry.navigation })
			await waitFor(next.actor, (s) => s.status === 'done')
			expect(f.view().identityRestore).toMatchObject({
				busy: false,
				error: false,
				navigationError: false,
				canRetryNavigation: false
			})
			expect(navigate).toHaveBeenCalledTimes(2)
			expect(f.changeIdentity).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('waits for issued native navigation before closing the SDK and storage', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>(),
			navigate = vi.fn((_destination: string) => held.promise)
		try {
			await f.start()
			const r = restoreFixture(f, undefined, navigate)
			await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
			expect(r.actor.getSnapshot().context.request).toBeUndefined()
			f.actor.send({ type: 'CLOSE' })
			expect(f.view().status).toBe('closing')
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			held.resolve()
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(r.actor.getSnapshot().output?.outcome).toBe('closed')
			expect(f.nativeClose).toHaveBeenCalledOnce()
			expect(f.closeAccountStore).toHaveBeenCalledOnce()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('does not redirect after the user has left the recovery origin', async () => {
		const f = fixture(),
			held = Promise.withResolvers<'completed'>()
		f.changeIdentity.mockImplementation(() => held.promise)
		try {
			await f.start()
			const r = restoreFixture(f)
			await vi.waitFor(() => expect(f.changeIdentity).toHaveBeenCalledOnce())
			f.actor.send({ type: 'OBSERVE_LOCATION', href: '/elsewhere' })
			held.resolve('completed')
			await waitFor(r.actor, (s) => s.status === 'done')
			expect(r.navigate).not.toHaveBeenCalled()
			expect(f.view().identityRestore.busy).toBe(false)
		} finally {
			held.resolve('completed')
			f.stop()
		}
	})
	it('withdraws a failed private owner and does not wait for a dead owner during close', async () => {
		const f = fixture(),
			parsed = Promise.withResolvers<string>()
		try {
			await f.start()
			const r = restoreFixture(
				f,
				vi.fn(() => parsed.promise)
			)
			f.actor.send({ type: 'RESTORATION_FAILED', ...r.scope })
			expect(f.view().status).toBe('failed')
			r.actor.send({ type: 'SHUTDOWN' })
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).toHaveBeenCalledOnce()
			expect(f.changeIdentity).not.toHaveBeenCalled()
		} finally {
			parsed.resolve('late-secret')
			f.stop()
		}
	})
})
