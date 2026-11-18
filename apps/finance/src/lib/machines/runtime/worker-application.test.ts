import { createActor, waitFor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import {
	createSessionRuntimeMachine,
	createSessionRuntimeConnection,
	type SessionRuntimeObservation,
	type SessionRuntimeResource
} from 'delightful-local-first/session/runtime'
import { financeWorkerMachine, selectFinanceWorkerView } from './worker-application.js'
import type {
	FinanceReadCapabilities,
	WorkerAccount,
	WorkerWorkspace
} from '../../contracts/worker-application.js'

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
	let observed = (_: SessionRuntimeObservation<FinanceReadCapabilities>) => {}
	const directory: {
		publish: (rows: WorkerWorkspace[]) => void
		failed: () => void
		release: ReturnType<typeof vi.fn<() => void>>
	}[] = []
	const queries: {
		workspaceId: string
		publish: (rows: WorkerAccount[]) => void
		failed: () => void
		release: ReturnType<typeof vi.fn<() => void>>
	}[] = []
	const capabilities: FinanceReadCapabilities = {
		observeWorkspaces: (publish, failed) => {
			const release = vi.fn(() => {
				order.push('directory')
			})
			directory.push({ publish, failed, release })
			return release
		},
		observeAccounts: (workspaceId, publish, failed) => {
			const release = vi.fn(() => {
				order.push('query')
			})
			queries.push({ workspaceId, publish, failed, release })
			return release
		}
	}
	const ready = (binding: object): SessionRuntimeObservation<FinanceReadCapabilities> => ({
		status: 'ready',
		binding,
		identityId: userId,
		identityKind: 'device',
		localFirst: true,
		capabilities
	})
	const nativeClose = vi.fn(async () => {
		order.push('sdk')
	})
	const resource: SessionRuntimeResource<FinanceReadCapabilities> = {
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
	const runtime = createActor(createSessionRuntimeMachine<FinanceReadCapabilities>(), {
		input: { binding, capability: { open } }
	})
	const closeAccountStore = vi.fn(async () => {
		order.push('store')
	})
	const closeBroker = vi.fn(async () => {
		order.push('broker')
		return brokerIdentity
	})
	const actor = createActor(financeWorkerMachine, {
		input: {
			session: createSessionRuntimeConnection(runtime, binding),
			closeAccountStore,
			closeBroker,
			brokerIdentity
		}
	})
	const start = async () => {
		actor.start()
		runtime.start()
		await waitFor(actor, (s) => !!s.context.ready)
	}
	const select = (workspaceId: string, revision: number) =>
		actor.send({ type: 'SELECT_WORKSPACE', selection: { workspaceId, revision } })
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
		start,
		select,
		ready,
		publishSession: (value: SessionRuntimeObservation<FinanceReadCapabilities>) => observed(value),
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
			expect(f.view().accounts).toEqual([row('first A')])
			f.select(b, 2)
			expect(f.view().accounts).toEqual([])
			const second = last(f.queries)
			second.publish([row('B')])
			first.publish([row('late first A')])
			if (!firstBinding) throw new Error('Missing retired binding')
			f.actor.send({ type: 'ACCOUNTS', binding: firstBinding, rows: [row('stale report')] })
			expect(f.view().accounts).toEqual([row('B')])
			f.select(a, 3)
			last(f.queries).publish([row('new A')])
			first.publish([row('original A')])
			expect(f.view().accounts).toEqual([row('new A')])
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
			expect(f.view().accounts).toEqual([row('current')])
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
			acquired = Promise.withResolvers<SessionRuntimeResource<FinanceReadCapabilities>>()
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
				await waitFor(f.actor, (s) => s.matches('failed'))
				expect(f.actor.getSnapshot().output).toBeUndefined()
				if (fault === 'sdk') expect(f.closeAccountStore).not.toHaveBeenCalled()
				if (fault === 'store') expect(f.closeBroker).not.toHaveBeenCalled()
			} finally {
				f.stop()
			}
		}
	)
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
			await waitFor(f.actor, (s) => s.matches('failed'))
			expect(f.actor.getSnapshot().output).toBeUndefined()
			expect(f.nativeClose).not.toHaveBeenCalled()
			expect(f.closeAccountStore).not.toHaveBeenCalled()
		} finally {
			f.stop()
		}
	})
})
