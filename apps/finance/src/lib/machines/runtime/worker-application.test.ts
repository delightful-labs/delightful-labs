import type { Db } from 'jazz-tools'
import { createAccountDeleteGrantMachine } from '../accounts/account-delete-grants.js'
import { createWorkspaceBackupMachine } from '../workspaces/workspace-backup.js'
import { createWorkspaceRestoreController } from '../workspaces/workspace-restore.js'
import { createProfileFormOptions } from '../identity/profile.js'
import { createWorkspaceRenameFormOptions } from '../workspaces/workspace-rename.js'
import {
	createCategoryManagementFormOptions,
	createTagManagementFormOptions
} from '../management/classification-forms.js'
import { createWorkspaceNavigationMachine } from '../workspaces/workspace-navigation.js'
import type { WorkspaceNavigate } from '../../contracts/workspace-orchestration-contract.js'
import { sessionRecoveryMachine } from 'delightful-local-first/recovery/coordination'
import type { RecoveryRequest } from 'delightful-local-first/recovery/coordination'
import type { SessionRuntimeIdentityChange } from 'delightful-local-first/session/runtime'
import { createActor, waitFor, type ActorFromLogic } from 'xstate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { app } from '../../queries.js'
import type { WorkerFormCommand } from '../../contracts/worker-forms.js'
import type { ArchiveObservation } from '../accounts/account-archive-operation.js'
import {
	financeWorkspaceAccessMachine,
	selectFinanceWorkspaceAccessFacts
} from './worker-workspace-access.js'

beforeEach(() => {
	const events = new EventTarget()
	vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
	vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
})
afterEach(() => vi.unstubAllGlobals())
const userId = '10000000-0000-4000-8000-000000000001',
	a = '20000000-0000-4000-8000-000000000001',
	b = '20000000-0000-4000-8000-000000000002'
const row = (name: string): WorkerAccount => ({
	id: '30000000-0000-4000-8000-000000000001',
	name,
	kind: 'cash',
	currency: 'USD'
})
function fixture(
	initialization?: InputFrom<typeof workspaceInitialization>['db'],
	navigateProvider?: (url: string) => Promise<void>,
	clearAppSession?: () => Promise<void>
) {
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
	const formDb = {
		...transactionDb.db,
		one: (async () => null) satisfies Db['one'],
		subscribe: vi.fn<Db['subscribe']>(() => () => {}),
		onMutationError: vi.fn<Db['onMutationError']>(() => () => {}),
		insert: (() => {
			throw new Error('Unexpected fixture insert')
		}) satisfies Db['insert'],
		insertStreaming: (() => {
			throw new Error('Unexpected fixture insertStreaming')
		}) satisfies Db['insertStreaming'],
		update: (() => {
			throw new Error('Unexpected fixture update')
		}) satisfies Db['update'],
		delete: (() => {
			throw new Error('Unexpected fixture delete')
		}) satisfies Db['delete'],
		transaction: (() => {
			throw new Error('Unexpected fixture transaction')
		}) satisfies Db['transaction'],
		beginSerializableTransaction: (() => {
			throw new Error('Unexpected fixture beginSerializableTransaction')
		}) satisfies Db['beginSerializableTransaction'],
		getConfig: vi.fn<Db['getConfig']>(() => ({})),
		getAuthState: (() => {
			throw new Error('Unexpected fixture getAuthState')
		}) satisfies Db['getAuthState']
	}

	const ledgers: { publish: (rows: WorkerLedgerRecord[]) => void; failed: () => void }[] = []
	const details: {
		publish: (row: TransactionEntryObservation['transaction']) => void
		release: ReturnType<typeof vi.fn>
	}[] = []
	const recoveryRead = vi.fn(async () => 'fixture phrase')
	const saveProfileName = vi.fn<Parameters<typeof createProfileFormOptions>[0]['saveName']>(
		async () => {}
	)
	const navigate = vi.fn<WorkspaceNavigate>(async () => {})
	const archiveWrite = vi.fn(async (_accountId: string) => {})
	const createCategoryWrite = vi.fn<
		Parameters<typeof createCategoryManagementFormOptions>[0]['create']
	>(async (organizationId, values) => ({
		...values,
		id: crypto.randomUUID(),
		organizationId,
		isSystem: false,
		archivedAt: null
	}))
	const createTagWrite = vi.fn<Parameters<typeof createTagManagementFormOptions>[0]['create']>(
		async (organizationId, values) => ({
			...values,
			id: crypto.randomUUID(),
			organizationId,
			archivedAt: null
		})
	)
	const archiveCategoryWrite = vi.fn(async (_id: string) => {})
	const archiveTagWrite = vi.fn(async (_id: string) => {})

	const accountOrderRead = vi.fn(async (_key: string): Promise<readonly string[]> => [])
	const accountOrderWrite = vi.fn(async (_key: string, _ids: readonly string[]) => {})
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
		observeBankConnections: (_id, publish) => {
			publish([])
			return () => {}
		},
		observeBankLinks: (_id, publish) => {
			publish([])
			return () => {}
		},
		observeTransfers: (_id, publish) => {
			publish([])
			return () => {}
		},
		observeWorkspaceMembers: (_id, publish) => {
			publish([])
			return () => {}
		},
		observeAccountGrants: (_id, publish) => {
			publish([])
			return () => {}
		},
		observeProfile: (publish) => {
			publish({
				id: '22222222-2222-4222-8222-222222222222',
				userId,
				displayName: null,
				avatarData: null,
				avatarMimeType: null
			})
			return () => {}
		},
		observeWorkspace: (id, publish) => {
			publish({
				id,
				name: 'Fixture workspace',
				ownerId: userId,
				kind: 'personal',
				defaultCurrency: 'USD'
			})
			return () => {}
		},
		prepareWorkspaceRestore: () => {
			throw new Error('Restore is outside this root fixture')
		},

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
	const ready = (
		binding: object
	): Extract<SessionRuntimeObservation<FinanceWorkerCapabilities>, { status: 'ready' }> => ({
		status: 'ready',
		binding,
		identityId: userId,
		identityKind: 'device',
		localFirst: true,
		capabilities: {
			...capabilities,
			createForms: (observe, _archive, navigate, accountOrderStorage, transferDispatch) =>
				createFinanceFormsMachine({
					transferDispatch,
					creationKey: JSON.stringify(['unit', userId]),
					accountAccess: createAccountDeleteGrantMachine(
						vi.fn(async () => {}),
						() => observe().accountAccess
					),
					backup: createWorkspaceBackupMachine({
						db: formDb,
						observe: () => observe().backup,
						environment: 'unit',
						handoff: { dispatch: async () => 'dispatched' }
					}),
					restore: createWorkspaceRestoreController(vi.fn(async () => {})),
					reload: vi.fn(),
					profile: createProfileFormOptions({
						binding,
						observe: () => observe().profile,
						saveName: saveProfileName,
						saveAvatar: vi.fn(async () => {})
					}),
					workspace: createWorkspaceRenameFormOptions({
						binding,
						observe: () => observe().workspace,
						issueRename: () => ({ write: async () => {} }),
						persistLocal: vi.fn(async () => {})
					}),
					binding,
					accountOrderStorage,
					classification: {
						categories: createCategoryManagementFormOptions({
							binding,
							observe: () => observe().classification,
							create: createCategoryWrite,
							archive: archiveCategoryWrite
						}),
						tags: createTagManagementFormOptions({
							binding,
							observe: () => observe().classification,
							create: createTagWrite,
							archive: archiveTagWrite
						})
					},
					observe,
					create: createWrite,
					archive: archiveWrite,
					navigation: createWorkspaceNavigationMachine({ one: async () => null }, navigate),
					db: formDb,
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
			accountOrderStorage: { read: accountOrderRead, write: accountOrderWrite },
			closeAccountStore,
			closeBroker,
			brokerIdentity,
			navigate,
			...(navigateProvider ? { navigateProvider } : {}),
			...(clearAppSession ? { clearAppSession } : {})
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
		accountOrderRead,
		accountOrderWrite,
		archiveWrite,
		createCategoryWrite,
		createTagWrite,
		archiveCategoryWrite,
		archiveTagWrite,
		navigate,
		recoveryRead,
		saveProfileName,
		createWrite,
		transactionDb,
		enter: (command: WorkerFormCommand, scope = selectFinanceWorkerView(actor.getSnapshot())) =>
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
		create: (command: WorkerFormCommand, scope = selectFinanceWorkerView(actor.getSnapshot())) =>
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

describe('Finance access observations composed through DLF', () => {
	function accessFixture(fault?: { source: string; stage: 'construction' | 'disposal' }) {
		const native = fixture()
		const subscriptions: {
			source: string
			emit: () => void
			failed: () => void
			release: ReturnType<typeof vi.fn>
		}[] = []
		function subscribe(source: string, emit: () => void, failed: () => void) {
			if (fault?.source === source && fault.stage === 'construction')
				throw new Error('Cannot subscribe')
			const release = vi.fn(() => {
				if (fault?.source === source && fault.stage === 'disposal')
					throw new Error('Cannot dispose')
			})
			subscriptions.push({ source, emit, failed, release })
			return release
		}
		const admitted = native.ready({})
		const ready = {
			...admitted,
			capabilities: {
				...admitted.capabilities,
				observeProfile: ((publish, failed) =>
					subscribe(
						'profile',
						() => publish(null),
						failed
					)) satisfies FinanceWorkerCapabilities['observeProfile'],
				observeWorkspaces: ((publish, failed) =>
					subscribe(
						'directory',
						() => publish([]),
						failed
					)) satisfies FinanceWorkerCapabilities['observeWorkspaces'],
				observeWorkspace: ((_id, publish, failed) =>
					subscribe(
						'workspace',
						() => publish(null),
						failed
					)) satisfies FinanceWorkerCapabilities['observeWorkspace'],
				observeMembership: ((_id, publish, failed) =>
					subscribe(
						'membership',
						() => publish(null),
						failed
					)) satisfies FinanceWorkerCapabilities['observeMembership']
			}
		}
		const disposalFailed = vi.fn()
		function open(
			workspaceId: string | null,
			binding: object = {},
			initialWorkspaces: WorkerWorkspace[] | null = null
		) {
			const owner = createActor(financeWorkspaceAccessMachine, {
				input: {
					ready,
					workspaceId,
					binding,
					initialWorkspaces,
					initialProfile: null,
					reportDisposalFailure: disposalFailed
				}
			})
			owner.start()
			return owner
		}
		return { open, subscriptions, disposalFailed }
	}
	it('keeps cached identity and directory facts on a global route without target subscriptions', () => {
		const f = accessFixture()
		const cached: WorkerWorkspace[] = [{ id: a, name: 'Cached A', defaultCurrency: 'USD' }]
		const owner = f.open(null, {}, cached)
		try {
			expect(f.subscriptions.map((s) => s.source)).toEqual(['profile', 'directory'])
			expect(selectFinanceWorkspaceAccessFacts(owner.getSnapshot())).toMatchObject({
				status: 'observing',
				profile: null,
				workspaces: cached,
				workspace: undefined,
				membership: undefined
			})
			f.subscriptions.forEach((s) => s.emit())
			expect(selectFinanceWorkspaceAccessFacts(owner.getSnapshot()).workspaces).toEqual([])
		} finally {
			owner.stop()
		}
		expect(f.subscriptions.every((s) => s.release.mock.calls.length === 1)).toBe(true)
	})
	it('keeps unknown target evidence distinct from observed absence without granting access from a directory', () => {
		const f = accessFixture()
		const owner = f.open(a, {}, [{ id: a, name: 'A', defaultCurrency: 'USD' }])
		try {
			expect(selectFinanceWorkspaceAccessFacts(owner.getSnapshot())).toMatchObject({
				workspace: undefined,
				membership: undefined
			})
			f.subscriptions
				.filter((s) => s.source === 'workspace' || s.source === 'membership')
				.forEach((s) => s.emit())
			expect(selectFinanceWorkspaceAccessFacts(owner.getSnapshot())).toMatchObject({
				status: 'observing',
				workspace: null,
				membership: null,
				workspaces: [{ id: a }]
			})
		} finally {
			owner.stop()
		}
	})
	it.each(['profile', 'directory', 'workspace', 'membership'])(
		'withdraws all facts and disposes observers after %s read failure',
		(source) => {
			const f = accessFixture()
			const owner = f.open(a)
			try {
				f.subscriptions.forEach((s) => s.emit())
				const failed = f.subscriptions.find((s) => s.source === source)
				if (!failed) throw new Error('Missing source')
				failed.failed()
				f.subscriptions.forEach((s) => s.emit())
				expect(selectFinanceWorkspaceAccessFacts(owner.getSnapshot())).toMatchObject({
					status: 'failed',
					profile: undefined,
					workspaces: null,
					workspace: undefined,
					membership: undefined
				})
				expect(f.subscriptions.every((s) => s.release.mock.calls.length === 1)).toBe(true)
			} finally {
				owner.stop()
			}
		}
	)
	it.each(['profile', 'directory', 'workspace', 'membership'])(
		'fails closed after %s subscription construction throws',
		(source) => {
			const f = accessFixture({ source, stage: 'construction' })
			const owner = f.open(a)
			try {
				expect(selectFinanceWorkspaceAccessFacts(owner.getSnapshot())).toMatchObject({
					status: 'failed',
					workspaces: null,
					profile: undefined
				})
				expect(f.subscriptions.every((s) => s.release.mock.calls.length === 1)).toBe(true)
			} finally {
				owner.stop()
			}
		}
	)
	it.each(['profile', 'directory', 'workspace', 'membership'])(
		'reports %s disposal failure to the native release owner exactly once',
		(source) => {
			const f = accessFixture({ source, stage: 'disposal' })
			const owner = f.open(a)
			owner.stop()
			owner.stop()
			expect(f.disposalFailed).toHaveBeenCalledOnce()
			expect(f.subscriptions.every((s) => s.release.mock.calls.length === 1)).toBe(true)
		}
	)
	it('rejects foreign reports and retired callbacks across A → B → A', () => {
		const f = accessFixture()
		const firstBinding = {}
		const first = f.open(a, firstBinding)
		const old = [...f.subscriptions]
		first.stop()
		const second = f.open(b)
		second.stop()
		const current = f.open(a)
		try {
			current.send({
				type: 'WORKSPACES',
				binding: firstBinding,
				rows: [{ id: a, name: 'Retired', defaultCurrency: 'USD' }]
			})
			current.send({ type: 'READ_FAILED', binding: firstBinding })
			old.forEach((s) => {
				s.emit()
				s.failed()
			})
			expect(selectFinanceWorkspaceAccessFacts(current.getSnapshot())).toMatchObject({
				status: 'observing',
				workspaces: null,
				membership: undefined
			})
			f.subscriptions.slice(-4).forEach((s) => s.emit())
			expect(selectFinanceWorkspaceAccessFacts(current.getSnapshot())).toMatchObject({
				status: 'observing',
				workspaces: [],
				membership: null
			})
		} finally {
			current.stop()
		}
	})
})

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
	it('reads browser URL filters/pages without requesting another navigation', async () => {
		const f = fixture()
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
				internalTransferId: null,
				tagNames: []
			}))
			last(f.ledgers).publish(records)
			expect(f.view().ledger).toMatchObject({ page: 2, pageCount: 2, filters: { query: 'rent' } })
			expect(f.view().ledger?.groups.flatMap((g) => g.transactions)).toHaveLength(5)
			const scope = f.view()
			const subscriptions = f.directory.length
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses',
				search: '?workspace=' + a + '&q=rent+29&start=2026-11-18&currency=USD',
				hash: '#row',
				revision: 2
			})
			expect(f.directory).toHaveLength(subscriptions)
			await vi.waitFor(() => expect(f.view().workspaceNavigation?.status).toBe('scoped'))
			expect(f.navigate).not.toHaveBeenCalled()
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
			expect(f.navigate).not.toHaveBeenCalled()
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
			await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledOnce())
			expect(f.navigate).toHaveBeenLastCalledWith(
				'/expenses?workspace=' + a + '&q=rent&keep=yes#row',
				expect.any(AbortSignal),
				expect.any(String),
				false
			)
		} finally {
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
	it('filters selected accounts before totals, retains balances and subscriptions, and resets the mask at scope replacement', async () => {
		const f = fixture(),
			accountB = '30000000-0000-4000-8000-000000000002'
		try {
			await f.start()
			last(f.directory).publish([
				{ id: a, name: 'A' },
				{ id: b, name: 'B' }
			])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet A'), { ...row('Wallet B'), id: accountB }])
			const records: WorkerLedgerRecord[] = [
				{
					id: crypto.randomUUID(),
					organizationId: a,
					accountId: row('Wallet A').id,
					categoryId: '50000000-0000-4000-8000-000000000001',
					kind: 'expense',
					currency: 'USD',
					amountMinor: 1200,
					bookedOn: '2026-11-18',
					description: 'From A',
					memo: null,
					internalTransferId: null,
					tagNames: []
				},
				{
					id: crypto.randomUUID(),
					organizationId: a,
					accountId: accountB,
					categoryId: '50000000-0000-4000-8000-000000000001',
					kind: 'expense',
					currency: 'USD',
					amountMinor: 500,
					bookedOn: '2026-11-18',
					description: 'From B',
					memo: null,
					internalTransferId: null,
					tagNames: []
				}
			]
			last(f.ledgers).publish(records)
			const scope = f.view(),
				subscription = last(f.queries)
			f.actor.send({
				type: 'SET_LEDGER_PAGE',
				page: 2,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			f.actor.send({
				type: 'SET_ACCOUNT_SELECTED',
				accountId: row('Wallet A').id,
				checked: false,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			expect(f.view().selectedAccountIds).toEqual([accountB])
			expect(f.view().ledger?.groups[0]?.transactions.map((t) => t.description)).toEqual(['From B'])
			expect(f.view().ledger?.groups[0]?.totals).toEqual([['USD', 500n]])
			expect(f.view().accounts.map((a) => a.balanceMinor)).toEqual([-1200n, -500n])
			await vi.waitFor(() => expect(f.view().transactionEntry?.defaultAccountId).toBe(accountB))
			expect(f.actor.getSnapshot().context.ledgerPage).toBe(1)
			expect(last(f.queries)).toBe(subscription)
			f.actor.send({
				type: 'SET_ALL_ACCOUNTS_SELECTED',
				checked: false,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			expect(f.view().ledger).toMatchObject({ noAccountsSelected: true, groups: [] })
			f.actor.send({
				type: 'SET_ACCOUNT_SELECTED',
				accountId: crypto.randomUUID(),
				checked: true,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			expect(f.view().selectedAccountIds).toEqual([])
			f.actor.send({
				type: 'SET_ALL_ACCOUNTS_SELECTED',
				checked: true,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			expect(f.view().selectedAccountIds).toBeNull()
			const extraAccount = '30000000-0000-4000-8000-000000000003'
			last(f.queries).publish([
				row('Wallet A'),
				{ ...row('Wallet B'), id: accountB },
				{ ...row('New'), id: extraAccount }
			])
			const first = records[0]
			if (!first) throw new Error('Missing ledger fixture')
			last(f.ledgers).publish([
				...records,
				{ ...first, id: crypto.randomUUID(), accountId: extraAccount, description: 'New account' }
			])
			expect(f.view().ledger?.groups.flatMap((g) => g.transactions)).toHaveLength(3)
			f.actor.send({
				type: 'SET_ALL_ACCOUNTS_SELECTED',
				checked: false,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			f.select(b, 2)
			expect(f.view().selectedAccountIds).toBeNull()
			f.actor.send({
				type: 'SET_ALL_ACCOUNTS_SELECTED',
				checked: false,
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			expect(f.view().selectedAccountIds).toBeNull()
			last(f.queries).publish([row('B')])
			const current = f.view()
			f.actor.send({
				type: 'SET_ALL_ACCOUNTS_SELECTED',
				checked: false,
				selection: current.selection,
				sessionRevision: current.sessionRevision
			})
			expect(f.view().selectedAccountIds).toEqual([])
			f.publishSession(f.ready({}))
			expect(f.view().selectedAccountIds).toBeNull()
		} finally {
			f.stop()
		}
	})
	it('navigates scoped transaction intents with list context and rebinds the observed detail after SDK replacement', async () => {
		const f = fixture(),
			id = crypto.randomUUID()
		try {
			await f.start()
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses',
				search: '?workspace=' + a + '&page=2&q=rent&currency=USD',
				hash: '#row',
				revision: 1
			})
			last(f.directory).publish([{ id: a, name: 'A' }])
			last(f.queries).publish([row('Wallet')])
			last(f.ledgers).publish([
				{
					id,
					organizationId: a,
					accountId: row('Wallet').id,
					categoryId: '50000000-0000-4000-8000-000000000001',
					kind: 'expense',
					currency: 'USD',
					amountMinor: 100,
					bookedOn: '2026-11-18',
					description: 'Rent',
					memo: null,
					internalTransferId: null,
					tagNames: []
				}
			])
			const scope = f.view()
			f.actor.send({
				type: 'OPEN_TRANSACTION',
				transactionId: crypto.randomUUID(),
				sessionRevision: scope.sessionRevision,
				selection: scope.selection
			})
			expect(f.navigate).not.toHaveBeenCalled()
			f.actor.send({
				type: 'OPEN_TRANSACTION',
				transactionId: id,
				sessionRevision: scope.sessionRevision,
				selection: scope.selection
			})
			await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledOnce())
			expect(f.navigate).toHaveBeenCalledWith(
				'/expenses/' + id + '?workspace=' + a + '&currency=USD&q=rent&page=2',
				expect.any(AbortSignal),
				'/expenses?workspace=' + a + '&page=2&q=rent&currency=USD#row',
				false
			)
			expect(f.view().transactionId).toBeNull()
			f.actor.send({
				type: 'OBSERVE_ROUTE',
				pathname: '/expenses/' + id,
				search: '?workspace=' + a + '&currency=USD&q=rent&page=2',
				hash: '',
				revision: 2
			})
			expect(f.view().transactionId).toBe(id)
			f.actor.send({
				type: 'OPEN_TRANSACTION',
				transactionId: null,
				sessionRevision: scope.sessionRevision,
				selection: scope.selection
			})
			expect(f.navigate).toHaveBeenCalledOnce()
			const generation = f.view().sessionRevision,
				oldDetails = last(f.details)
			f.publishSession(f.ready({}))
			await vi.waitFor(() => expect(f.view().sessionRevision).toBeGreaterThan(generation))
			await vi.waitFor(() => expect(last(f.details)).not.toBe(oldDetails))
			expect(oldDetails.release).toHaveBeenCalledOnce()
			expect(f.view().transactionId).toBe(id)
			expect(f.view().transactionEdit).toMatchObject({
				transactionId: id,
				initialTransaction: null,
				form: { canSubmit: false, readiness: { kind: 'blocked', reason: 'loading' } }
			})
			expect(f.actor.getSnapshot().context.ledgerFilters.query).toBe('rent')
			expect(f.actor.getSnapshot().context.ledgerPage).toBe(2)
			const current = f.view()
			f.actor.send({
				type: 'OPEN_TRANSACTION',
				transactionId: null,
				sessionRevision: current.sessionRevision,
				selection: current.selection
			})
			await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledTimes(2))
			expect(f.navigate).toHaveBeenLastCalledWith(
				'/expenses?workspace=' + a + '&currency=USD&q=rent&page=2',
				expect.any(AbortSignal),
				'/expenses/' + id + '?workspace=' + a + '&currency=USD&q=rent&page=2',
				false
			)
		} finally {
			f.stop()
		}
	})
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
				internalTransferId: null,
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
			await vi.waitFor(() => expect(f.view().transactionEntry?.form.canSubmit).toBe(true))
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

	it('waits for an issued profile save in the identity owner before acknowledging clean native close', async () => {
		const f = fixture(),
			saved = Promise.withResolvers<void>()
		f.saveProfileName.mockImplementation(() => saved.promise)
		try {
			await f.start()
			f.select(a, 1)
			last(f.directory).publish([{ id: a, name: 'A' }])
			last(f.queries).publish([])
			const scope = f.view()
			f.actor.send({
				type: 'PROFILE',
				form: 'name',
				command: { type: 'SUBMIT', values: { displayName: 'Saved identity' } },
				selection: scope.selection,
				sessionRevision: scope.sessionRevision
			})
			await vi.waitFor(() => expect(f.saveProfileName).toHaveBeenCalledOnce())
			f.actor.send({ type: 'CLOSE' })
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().output).toBeUndefined()
			saved.resolve()
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.saveProfileName).toHaveBeenCalledExactlyOnceWith(
				'22222222-2222-4222-8222-222222222222',
				userId,
				'Saved identity'
			)
			expect(f.nativeClose).toHaveBeenCalledOnce()
		} finally {
			saved.resolve()
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
			await vi.waitFor(() => expect(f.actor.getSnapshot().context.formsView).toBeDefined())
			const formsView = f.actor.getSnapshot().context.formsView
			if (!formsView) throw new Error('Missing current forms report')
			f.actor.send({ type: 'CLOSE' })
			f.actor.send({
				type: 'FORMS_VIEW',
				binding: {},
				view: { ...formsView, status: 'failed', creation: null, transaction: null, edit: null }
			})
			expect(f.actor.getSnapshot().matches('draining')).toBe(true)
			expect(f.nativeClose).not.toHaveBeenCalled()
			pending.resolve()
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('refuses native release when initialization reported unknown settlement before shutdown', async () => {
		const initial = workspaceCreationFixture()
		initial.one.mockReset().mockResolvedValue(null)
		initial.wait.mockRejectedValue(new Error('Local settlement unavailable'))
		const f = fixture({
			...initial.db,
			all: vi.fn().mockResolvedValue([]),
			getConfig: () => ({ serverUrl: 'https://authority.invalid' })
		})
		try {
			await f.start()
			await vi.waitFor(() => expect(f.view().workspaceStartup).toBe('failed'))
			expect(f.nativeClose).not.toHaveBeenCalled()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.matches('drainFailed'))
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().output).toBeUndefined()
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
				await vi.waitFor(() => expect(f.view().transactionEntry?.form.canSubmit).toBe(true))
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
			} satisfies WorkerFormCommand
			f.enter(command, old)
			expect(f.transactionDb.insert).not.toHaveBeenCalled()
			f.enter(command)
			await vi.waitFor(() => expect(f.view().transactionEntry?.form.content.kind).toBe('success'))
			expect(f.transactionDb.commit).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('rejects stale ordering commands and drains an issued preference write before closing the SDK', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.accountOrderWrite.mockImplementation(() => held.promise)
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			const first = row('First'),
				second = { ...row('Second'), id: '30000000-0000-4000-8000-000000000002' }
			last(f.queries).publish([first, second])
			await vi.waitFor(() => expect(f.view().accountOrder?.ids).toEqual([first.id, second.id]))
			const scope = f.view()
			f.actor.send({
				type: 'ACCOUNT_ORDER',
				...{ selection: scope.selection, sessionRevision: scope.sessionRevision },
				command: { type: 'EDIT' }
			})
			f.actor.send({
				type: 'ACCOUNT_ORDER',
				selection: scope.selection,
				sessionRevision: scope.sessionRevision,
				command: { type: 'MOVE', id: second.id, direction: 'up' }
			})
			expect(f.view().accounts.map((account) => account.name)).toEqual(['Second', 'First'])
			expect(f.accountOrderWrite).toHaveBeenCalledOnce()
			f.select(b, 2)
			f.actor.send({
				type: 'ACCOUNT_ORDER',
				selection: scope.selection,
				sessionRevision: scope.sessionRevision,
				command: { type: 'MOVE', id: first.id, direction: 'up' }
			})
			expect(f.accountOrderWrite).toHaveBeenCalledOnce()
			f.actor.send({ type: 'CLOSE' })
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			held.resolve()
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).toHaveBeenCalledOnce()
			expect(f.closeAccountStore).toHaveBeenCalledOnce()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('keeps lists available while a preference read determines the fresh entry default', async () => {
		const f = fixture(),
			held = Promise.withResolvers<readonly string[]>()
		f.accountOrderRead.mockImplementationOnce(() => held.promise)
		const first = row('First'),
			second = { ...row('Second'), id: '30000000-0000-4000-8000-000000000002' }
		try {
			await f.start()
			f.select(a, 1)
			last(f.queries).publish([first, second])
			expect(f.view().accounts.map((account) => account.name)).toEqual(['First', 'Second'])
			expect(f.view().transactionEntry).toBeNull()
			held.resolve([second.id, first.id])
			await vi.waitFor(() => expect(f.view().transactionEntry?.defaultAccountId).toBe(second.id))
			expect(f.view().accounts.map((account) => account.name)).toEqual(['Second', 'First'])
		} finally {
			held.resolve([])
			f.stop()
		}
	})
	it('awaits an old ordering read before replacing the SDK group and rejects late preference data', async () => {
		const f = fixture(),
			held = Promise.withResolvers<readonly string[]>()
		f.accountOrderRead.mockImplementationOnce(() => held.promise)
		try {
			await f.start()
			f.select(a, 1)
			last(f.queries).publish([row('Old')])
			expect(f.accountOrderRead).toHaveBeenCalledOnce()
			f.publishSession({ status: 'transitioning' })
			f.publishSession(f.ready({}))
			expect(f.view().accounts).toEqual([])
			expect(f.view().accountOrder).toBeNull()
			expect(f.queries).toHaveLength(1)
			held.resolve([row('Old').id])
			await vi.waitFor(() => expect(f.queries).toHaveLength(2))
			last(f.queries).publish([row('Current')])
			await vi.waitFor(() => expect(f.view().accountOrder?.ids).toEqual([row('Current').id]))
			expect(f.view().accounts.map((account) => account.name)).toEqual(['Current'])
			expect(f.accountOrderRead).toHaveBeenCalledTimes(2)
			expect(f.accountOrderWrite).not.toHaveBeenCalled()
		} finally {
			held.resolve([])
			f.stop()
		}
	})

	it('keeps an existing transaction form published while a same-scope input command is handled', async () => {
		const f = fixture()
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			await vi.waitFor(() => expect(f.view().transactionEntry?.form.canSubmit).toBe(true))
			const withdrawals: boolean[] = []
			const subscription = f.actor.subscribe((snapshot) => {
				withdrawals.push(selectFinanceWorkerView(snapshot).transactionEntry === null)
			})
			f.enter({
				type: 'CHANGE',
				values: {
					accountId: row('Wallet').id,
					categoryId: '50000000-0000-4000-8000-000000000001',
					amount: '25.00',
					bookedOn: '2026-11-18',
					tags: []
				}
			})
			subscription.unsubscribe()
			expect(withdrawals).not.toContain(true)
		} finally {
			f.stop()
		}
	})
	it('drains a classification write through local settlement before SDK shutdown', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.createCategoryWrite.mockImplementation(async (organizationId, values) => {
			await held.promise
			return {
				...values,
				organizationId,
				id: crypto.randomUUID(),
				isSystem: false,
				archivedAt: null
			}
		})
		try {
			await f.start()
			last(f.directory).publish([{ id: a, name: 'A' }])
			f.select(a, 1)
			last(f.queries).publish([row('Wallet')])
			await vi.waitFor(() =>
				expect(f.view().classification?.forms.createCategory.canSubmit).toBe(true)
			)
			const scope = f.view()
			f.actor.send({
				type: 'CLASSIFICATION',
				form: 'createCategory',
				command: { type: 'SUBMIT', values: { name: 'Travel', kind: 'expense' } },
				sessionRevision: scope.sessionRevision,
				selection: scope.selection
			})
			await vi.waitFor(() => expect(f.createCategoryWrite).toHaveBeenCalledOnce())
			f.actor.send({ type: 'CLOSE' })
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			held.resolve()
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.nativeClose).toHaveBeenCalledOnce()
			expect(f.closeAccountStore).toHaveBeenCalledOnce()
		} finally {
			held.resolve()
			f.stop()
		}
	})
	it('refuses stale classification headers and protected system-category archive intents', async () => {
		const f = fixture()
		try {
			await f.start()
			f.select(a, 1)
			last(f.queries).publish([row('A')])
			await vi.waitFor(() => expect(f.view().classification).not.toBeNull())
			const old = f.view()
			f.select(b, 2)
			last(f.queries).publish([row('B')])
			f.actor.send({
				type: 'CLASSIFICATION',
				form: 'createCategory',
				command: { type: 'SUBMIT', values: { name: 'Wrong scope', kind: 'expense' } },
				sessionRevision: old.sessionRevision,
				selection: old.selection
			})
			expect(f.createCategoryWrite).not.toHaveBeenCalled()
			await vi.waitFor(() =>
				expect(f.view().classification?.forms.archiveCategory.canSubmit).toBe(true)
			)
			const scope = f.view()
			f.actor.send({
				type: 'CLASSIFICATION',
				form: 'archiveCategory',
				command: {
					type: 'SUBMIT',
					values: { categoryId: '50000000-0000-4000-8000-000000000001', organizationId: b }
				},
				sessionRevision: scope.sessionRevision,
				selection: scope.selection
			})
			await vi.waitFor(() =>
				expect(f.view().classification?.forms.archiveCategory.feedback).toMatchObject({
					kind: 'result',
					result: { outcome: 'denied', reason: 'protectedRecord' }
				})
			)
			expect(f.archiveCategoryWrite).not.toHaveBeenCalled()
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
			await vi.waitFor(() => expect(f.queries).toHaveLength(2))
			last(f.queries).publish([row('current')])
			last(f.directory).publish([{ id: a, name: 'current workspace' }])
			expect(f.view().accounts).toMatchObject([row('current')])
			expect(before.release).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})
	it('reports synchronous subscription construction failure without exposing an empty directory as ready', async () => {
		const f = fixture()
		try {
			await f.start()
			const next = f.ready({})
			f.publishSession({
				...next,
				capabilities: {
					...next.capabilities,
					observeWorkspaces: () => {
						throw new Error('Native directory subscribe failed')
					}
				}
			})
			await vi.waitFor(() => expect(f.view().status).toBe('failed'))
			expect(f.view().workspaces).toBeNull()
			expect(f.view().accounts).toEqual([])
			expect(f.createWrite).not.toHaveBeenCalled()
			expect(f.nativeClose).not.toHaveBeenCalled()
		} finally {
			f.stop()
		}
	})
	it.each(['directory', 'membership'])(
		'withdraws financial content when the composed access %s read fails',
		async (source) => {
			const f = fixture()
			try {
				await f.start()
				f.select(a, 1)
				last(f.directory).publish([{ id: a, name: 'A' }])
				const query = last(f.queries)
				query.publish([row('Visible')])
				expect(f.view().accounts).toMatchObject([row('Visible')])
				const access = source === 'directory' ? last(f.directory) : last(f.memberships)
				access.failed()
				expect(f.view()).toMatchObject({ status: 'failed', accounts: [], workspaces: null })
				expect(query.release).toHaveBeenCalledOnce()
				query.publish([row('Late')])
				expect(f.view().accounts).toEqual([])
				expect(f.createWrite).not.toHaveBeenCalled()
				expect(f.nativeClose).not.toHaveBeenCalled()
			} finally {
				f.stop()
			}
		}
	)

	it('retains access observations when same-workspace content reads change', async () => {
		const f = fixture()
		try {
			await f.start()
			f.select(a, 1)
			const directory = last(f.directory),
				membership = last(f.memberships),
				query = last(f.queries)
			const count = f.directory.length
			const accessBinding = f.actor.getSnapshot().context.accessBinding
			f.selectKind('income', 2)
			expect(f.directory).toHaveLength(count)
			expect(last(f.memberships)).toBe(membership)
			expect(directory.release).not.toHaveBeenCalled()
			expect(query.release).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().context.accessBinding).toBe(accessBinding)
			directory.publish([{ id: a, name: 'Current A' }])
			membership.publish(null)
			expect(f.actor.getSnapshot().context.facts).toMatchObject({
				workspaces: [{ name: 'Current A' }],
				membership: null
			})
			f.select(b, 3)
			expect(directory.release).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().context.accessBinding).not.toBe(accessBinding)
		} finally {
			f.stop()
		}
	})
	it('keeps access observations live after financial read failure while content remains withdrawn', async () => {
		const f = fixture()
		try {
			await f.start()
			f.select(a, 1)
			const directory = last(f.directory),
				membership = last(f.memberships),
				query = last(f.queries)
			query.publish([row('Visible')])
			query.failed()
			expect(f.view().status).toBe('failed')
			expect(directory.release).not.toHaveBeenCalled()
			directory.publish([{ id: b, name: 'New directory evidence' }])
			membership.publish(null)
			query.publish([row('Retired')])
			expect(f.view()).toMatchObject({ status: 'failed', accounts: [], workspaces: [{ id: b }] })
			expect(f.actor.getSnapshot().context.facts?.membership).toBeNull()
			expect(query.release).toHaveBeenCalledOnce()
			expect(f.createWrite).not.toHaveBeenCalled()
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
	it('retries native session errors on the retained owner and waits for settlement before reattaching', async () => {
		const f = fixture(),
			held = Promise.withResolvers<'completed' | 'bindingChanged'>()
		f.changeIdentity
			.mockRejectedValueOnce(new Error('Selection persistence still unavailable'))
			.mockImplementationOnce(() => held.promise)
		try {
			await f.start()
			f.publishSession({ status: 'error' })
			await waitFor(f.actor, (snapshot) => snapshot.matches('failed'))
			f.actor.send({ type: 'RETRY_SESSION' })
			await vi.waitFor(() => expect(f.changeIdentity).toHaveBeenCalledTimes(1))
			await waitFor(f.actor, (snapshot) => snapshot.matches('failed'))
			f.actor.send({ type: 'RETRY_SESSION' })
			await vi.waitFor(() => expect(f.changeIdentity).toHaveBeenCalledTimes(2))
			expect(f.changeIdentity).toHaveBeenLastCalledWith({ operation: 'retry' })
			expect(f.actor.getSnapshot().matches('retryingSession')).toBe(true)
			expect(f.view().canRetrySession).toBe(false)
			f.actor.send({ type: 'RETRY_SESSION' })
			f.publishSession(f.ready({}))
			expect(f.actor.getSnapshot().context.forms).toBeUndefined()
			held.resolve('completed')
			await waitFor(f.actor, (snapshot) => !!snapshot.context.ready)
			expect(f.changeIdentity).toHaveBeenCalledTimes(2)
			expect(f.open).toHaveBeenCalledOnce()
		} finally {
			held.resolve('completed')
			f.stop()
		}
	})
	it('retries failed acquisition through the same session change contract', async () => {
		const f = fixture()
		f.open.mockRejectedValueOnce(new Error('Native acquisition unavailable'))
		try {
			f.actor.start()
			f.runtime.start()
			await waitFor(f.actor, (snapshot) => snapshot.matches('failed'))
			f.actor.send({ type: 'RETRY_SESSION' })
			await waitFor(f.actor, (snapshot) => !!snapshot.context.ready)
			expect(f.open).toHaveBeenCalledTimes(2)
			expect(f.changeIdentity).not.toHaveBeenCalled()
		} finally {
			f.stop()
		}
	})
	it.each(['query', 'access directory'])(
		'does not acknowledge clean close when %s disposal throws',
		async (source) => {
			const f = fixture()
			try {
				await f.start()
				f.select(a, 1)
				const subscription = source === 'query' ? last(f.queries) : last(f.directory)
				subscription.release.mockImplementation(() => {
					throw new Error('Synthetic subscription disposal failure')
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
		}
	)
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
			expect(f.view().identityRestore).toMatchObject({ busy: false, feedback: 'invalidPhrase' })
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
			expect(f.view().identityRestore).toMatchObject({ busy: false, feedback: 'none' })
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
			const accessBinding = f.actor.getSnapshot().context.accessBinding
			const r = restoreFixture(f)
			await waitFor(r.actor, (s) => s.status === 'done')
			await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
			expect(f.actor.getSnapshot().context.forms?.owner).not.toBe(previous)
			expect(f.actor.getSnapshot().context.accessBinding).not.toBe(accessBinding)
			f.actor
				.getSnapshot()
				.children.workspaceAccess?.send({ type: 'READ_FAILED', binding: accessBinding })
			expect(f.actor.getSnapshot().context.accessFacts?.status).toBe('observing')
			expect(f.view().identityRestore).toMatchObject({ busy: false, feedback: 'sessionFailed' })
			expect(f.changeIdentity).toHaveBeenCalledOnce()
			f.actor.send({
				type: 'RESTORATION_FINISHED',
				scope: r.scope,
				result: { mutation: 'settled', outcome: 'restored' },
				view: f.actor.getSnapshot().context.session.view.get()
			})
			expect(f.view().identityRestore.feedback).toBe('sessionFailed')
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
			expect(f.view().identityRestore).toMatchObject({
				busy: false,
				feedback: 'none',
				canSubmit: true
			})
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
			expect(f.view().identityRestore).toMatchObject({ busy: false, feedback: 'none' })
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
				feedback: 'none',
				navigationError: true,
				canRetryNavigation: true
			})
			const retry = selectFinanceNavigationRetry(f.actor.getSnapshot(), f.view().sessionRevision)
			if (!retry) throw new Error('Navigation retry unavailable')
			const next = restoreFixture(f, undefined, navigate, { kind: 'navigate', ...retry.navigation })
			await waitFor(next.actor, (s) => s.status === 'done')
			expect(f.view().identityRestore).toMatchObject({
				busy: false,
				feedback: 'none',
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

describe('provider login admission and shutdown', () => {
	async function start(f: ReturnType<typeof fixture>) {
		await f.start()
		f.actor.send({ type: 'OBSERVE_ROUTE', pathname: '/login', search: '', hash: '', revision: 1 })
		return f.view().sessionRevision
	}
	it('confirms before provider work and waits for all close receipts before navigation', async () => {
		const navigated = vi.fn(async (_url: string) => {})
		const fetch = vi.fn(async () => Response.json({ url: 'https://provider.invalid/authorize' }))
		vi.stubGlobal('fetch', fetch)
		const f = fixture(undefined, navigated)
		const closed = Promise.withResolvers<void>()
		f.closeBroker.mockImplementation(async () => {
			await closed.promise
			return { scope: 'host', requestId: 'close-receipt' }
		})
		try {
			const sessionRevision = await start(f)
			f.actor.send({ type: 'BEGIN_AUTH', handle: 'person.example', sessionRevision })
			expect(f.view().auth?.confirmationRequired).toBe(true)
			expect(fetch).not.toHaveBeenCalled()
			f.actor.send({ type: 'CONFIRM_AUTH', sessionRevision })
			await vi.waitFor(() => expect(f.closeBroker).toHaveBeenCalledOnce())
			expect(f.nativeClose).toHaveBeenCalledOnce()
			expect(f.closeAccountStore).toHaveBeenCalledOnce()
			expect(navigated).not.toHaveBeenCalled()
			closed.resolve()
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(navigated).toHaveBeenCalledExactlyOnceWith('https://provider.invalid/authorize')
		} finally {
			closed.resolve()
			f.stop()
		}
	})
	it.each(['route', 'identity'])(
		'invalidates confirmation when the %s changes',
		async (changed) => {
			const navigated = vi.fn(async (_url: string) => {})
			const fetch = vi.fn()
			vi.stubGlobal('fetch', fetch)
			const f = fixture(undefined, navigated)
			try {
				const sessionRevision = await start(f)
				f.actor.send({ type: 'BEGIN_AUTH', handle: 'person.example', sessionRevision })
				if (changed === 'route')
					f.actor.send({
						type: 'OBSERVE_ROUTE',
						pathname: '/account',
						search: '',
						hash: '',
						revision: 2
					})
				else f.publishSession(f.ready({}))
				f.actor.send({ type: 'CONFIRM_AUTH', sessionRevision })
				expect(f.view().auth?.confirmationRequired).toBe(false)
				expect(fetch).not.toHaveBeenCalled()
				expect(navigated).not.toHaveBeenCalled()
			} finally {
				f.stop()
			}
		}
	)
	it('does not navigate after a native close failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ url: 'https://provider.invalid/authorize' }))
		)
		const navigated = vi.fn(async (_url: string) => {})
		const f = fixture(undefined, navigated)
		f.nativeClose.mockRejectedValueOnce(new Error('Synthetic native close failure'))
		try {
			const sessionRevision = await start(f)
			f.actor.send({ type: 'BEGIN_AUTH', handle: 'person.example', sessionRevision })
			f.actor.send({ type: 'CONFIRM_AUTH', sessionRevision })
			await waitFor(f.actor, (snapshot) => snapshot.matches('closeFailed'))
			expect(navigated).not.toHaveBeenCalled()
			expect(f.view().auth?.message?.key).toBe('login.atproto_failed')
		} finally {
			f.stop()
		}
	})
})

describe('ordered provider sign-out', () => {
	it('updates authentication facts without restarting a stable native binding', async () => {
		const f = fixture(
			undefined,
			async () => {},
			async () => {}
		)
		try {
			await f.start()
			const ready = f.actor.getSnapshot().context.ready
			if (!ready) throw new Error('Missing native ready observation')
			const revision = f.view().sessionRevision
			f.publishSession({ ...ready, identityKind: 'backend' })
			expect(f.view().auth?.canSignOut).toBe(true)
			expect(f.view().sessionRevision).toBe(revision)
			expect(f.open).toHaveBeenCalledOnce()
		} finally {
			f.stop()
		}
	})

	async function startBackend(f: ReturnType<typeof fixture>) {
		await f.start()
		f.publishSession({ ...f.ready({}), identityKind: 'backend' })
		await waitFor(f.actor, () => f.view().auth?.canSignOut === true)
		return f.view().sessionRevision
	}
	it('never offers provider sign-out for a silently initialized guest', async () => {
		const provider = vi.fn(async () => {})
		const f = fixture(undefined, async () => {}, provider)
		try {
			await f.start()
			f.actor.send({ type: 'SIGN_OUT', sessionRevision: f.view().sessionRevision })
			expect(f.view().auth?.canSignOut).toBe(false)
			expect(provider).not.toHaveBeenCalled()
			expect(f.changeIdentity).not.toHaveBeenCalled()
		} finally {
			f.stop()
		}
	})
	it('refuses native logout after provider failure and leaves the current identity usable', async () => {
		const provider = vi.fn(async () => {
			throw new Error('Synthetic provider failure')
		})
		const f = fixture(undefined, async () => {}, provider)
		try {
			const sessionRevision = await startBackend(f)
			f.actor.send({ type: 'SIGN_OUT', sessionRevision })
			await vi.waitFor(() =>
				expect(f.view().auth?.signOutMessage?.key).toBe('login.sign_out_failed')
			)
			expect(f.changeIdentity).not.toHaveBeenCalled()
			expect(f.view().identityId).toBe(userId)
			expect(f.view().auth?.canSignOut).toBe(true)
		} finally {
			f.stop()
		}
	})
	it('clears the app session before native logout and allows signed-out login without provisioning a guest', async () => {
		const order: string[] = []
		const f = fixture(
			undefined,
			async () => {},
			async () => {
				order.push('provider')
			}
		)
		f.changeIdentity.mockImplementation(async (change) => {
			order.push(change.operation)
			f.publishSession({ status: 'signed-out', binding: {} })
			return 'completed'
		})
		try {
			const sessionRevision = await startBackend(f)
			f.actor.send({ type: 'SIGN_OUT', sessionRevision })
			await waitFor(f.actor, () => f.view().status === 'signed-out')
			expect(order).toEqual(['provider', 'signOut'])
			expect(f.view().auth?.canBegin).toBe(true)
			expect(f.closeAccountStore).not.toHaveBeenCalled()
			expect(f.view().auth?.canSignOut).toBe(false)
		} finally {
			f.stop()
		}
	})
	it.each(['close', 'replacement'])(
		'retains a held provider effect during %s',
		async (interruption) => {
			const held = Promise.withResolvers<void>()
			const provider = vi.fn(() => held.promise)
			const f = fixture(undefined, async () => {}, provider)
			try {
				const sessionRevision = await startBackend(f)
				f.actor.send({ type: 'SIGN_OUT', sessionRevision })
				await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce())
				if (interruption === 'close') f.actor.send({ type: 'CLOSE' })
				else f.publishSession({ ...f.ready({}), identityKind: 'backend' })
				expect(f.changeIdentity).not.toHaveBeenCalled()
				expect(f.nativeClose).not.toHaveBeenCalled()
				held.resolve()
				if (interruption === 'close') {
					await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
					expect(f.changeIdentity).toHaveBeenCalledOnce()
					expect(f.nativeClose).toHaveBeenCalledOnce()
				} else {
					await vi.waitFor(() => expect(f.view().auth?.signOutBusy).toBe(false))
					expect(f.changeIdentity).not.toHaveBeenCalled()
					expect(f.view().identityId).toBe(userId)
				}
			} finally {
				held.resolve()
				f.stop()
			}
		}
	)
})
