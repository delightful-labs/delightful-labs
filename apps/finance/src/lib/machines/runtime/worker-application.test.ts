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
	selectFinanceArchiveObservation,
	selectFinanceFormObservations,
	selectFinanceArchiveWriter
} from './worker-application.js'
import type {
	FinanceWorkerCapabilities,
	WorkerAccount,
	WorkerAccountRecord,
	WorkerWorkspace
} from '../../contracts/worker-application.js'
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
function fixture() {
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
			createForms: (observe) =>
				createFinanceFormsMachine({ binding, observe, create: createWrite, db: transactionDb.db })
		}
	})
	const nativeClose = vi.fn(async () => {
		order.push('sdk')
	})
	const resource: SessionRuntimeResource<FinanceWorkerCapabilities> = {
		observe: (publish) => {
			observed = publish
			publish(ready({}))
			return () => {
				order.push('observer')
			}
		},
		close: nativeClose,
		changeIdentity: async () => 'completed'
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
		observe: () => selectFinanceArchiveObservation(owner?.getSnapshot()),
		observeForms: () => selectFinanceFormObservations(owner?.getSnapshot()),
		persist: (request) => {
			const write = selectFinanceArchiveWriter(owner?.getSnapshot(), request)
			return write ? write(request.accountId) : Promise.reject(new Error('Binding retired'))
		}
	})
	const actor = createActor(machine, {
		input: {
			session: createSessionRuntimeConnection(runtime, binding),
			closeAccountStore,
			closeBroker,
			brokerIdentity
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
		open,
		nativeClose,
		closeAccountStore,
		closeBroker,
		order,
		directory,
		queries,
		memberships,
		grants,
		archiveWrite,
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
				expect(f.actor.getSnapshot().matches({ draining: { archive: 'closed' } })).toBe(true)
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
			f.actor.getSnapshot().children.archive?.send({ type: 'SHUTDOWN' })
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
