import { Transaction } from 'jazz-tools'
import { afterEach, expect, it, vi } from 'vitest'
import { createSyncLogRetentionMachine, type RetentionScope } from './log-retention.js'
import { createSyncLogRetentionCoordinator } from './log-retention-coordinator.js'
import { dependencies, observation, connection, id } from './test-fixtures.js'
import type { SyncAttempt, SyncAccountResult } from '#lib/schema.js'
import { createActor, toPromise, waitFor, createAsyncLogic } from 'xstate'

const scope: RetentionScope = {
	organizationId: connection.organizationId,
	connectionId: connection.id,
	userId: connection.ownerId ?? id(1)
}
const row: SyncAttempt = {
	id: id(10),
	organizationId: scope.organizationId,
	connectionId: scope.connectionId,
	initiatedBy: scope.userId,
	startedAt: new Date(0),
	finishedAt: new Date(1),
	outcome: 'succeeded',
	importSettlement: 'notStarted',
	importedCount: 0,
	existingCount: 0,
	omittedCount: 0,
	failureCode: null
}
function resource() {
	const tx = new Transaction('serializable', () => {
		throw new Error('Unit fixture must not open Jazz')
	})
	vi.spyOn(tx, 'commit').mockImplementation(vi.fn().mockReturnValue({ wait: async () => {} }))
	return tx
}
function fixture() {
	const deps = dependencies()
	const tx = resource()
	const opened = vi.fn(async () => tx)
	const authorized = vi.fn(async () => true)
	const history = vi.fn(async (): Promise<SyncAttempt[]> =>
		Array.from({ length: 101 }, (_, index) => ({ ...row, id: id(index + 10) }))
	)
	const accounts = vi.fn(async (): Promise<SyncAccountResult[]> => [])
	const stage = vi.fn(async () => {})
	const commit = vi.fn(async () => tx.commit())
	const settle = vi.fn(async (): Promise<unknown> => undefined)
	const rollback = vi.fn(async () => true)
	const logic = createSyncLogRetentionMachine(deps, 30).provide({
		actors: {
			open: createAsyncLogic({ run: opened }),
			authorization: createAsyncLogic({ run: authorized }),
			history: createAsyncLogic({ run: history }),
			accounts: createAsyncLogic({ run: accounts }),
			stage: createAsyncLogic({ run: stage }),
			commit: createAsyncLogic({ run: commit }),
			settle: createAsyncLogic({ run: settle }),
			rollback: createAsyncLogic({ run: rollback })
		}
	})
	return { deps, tx, opened, authorized, history, accounts, stage, commit, settle, rollback, logic }
}
afterEach(() => vi.useRealTimers())
it('defers on an unanswered authority read without acquiring a transaction or staging deletes', async () => {
	const f = fixture()
	f.history.mockImplementation(() => new Promise(() => {}))
	const actor = createActor(f.logic, { input: { scope } }).start()
	expect(await toPromise(actor)).toEqual({
		kind: 'deferred',
		deletedCount: 0,
		settlement: 'notStarted'
	})
	expect(f.opened).not.toHaveBeenCalled()
	expect(f.rollback).not.toHaveBeenCalled()
	expect(f.stage).not.toHaveBeenCalled()
})
it('drains acquisition before cancelling and rolling back', async () => {
	const f = fixture(),
		pending = Promise.withResolvers<ReturnType<typeof resource>>()
	f.opened.mockReturnValue(pending.promise)
	const actor = createActor(f.logic, { input: { scope } }).start()
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'opening' } }))
	actor.send({ type: 'CANCEL' })
	expect(actor.getSnapshot().status).toBe('active')
	pending.resolve(f.tx)
	expect(await toPromise(actor)).toEqual({
		kind: 'cancelled',
		deletedCount: 0,
		settlement: 'notStarted'
	})
	expect(f.rollback).toHaveBeenCalledOnce()
	expect(f.authorized).toHaveBeenCalledOnce()
})
it('rolls back after authorization loss before staging', async () => {
	const deps = dependencies(),
		f = fixture()
	let reads = 0
	f.history.mockImplementation(async () => {
		reads += 1
		if (reads === 2) deps.observe = () => ({ ...observation, allowed: false })
		return Array.from({ length: 101 }, () => row)
	})
	const logic = createSyncLogRetentionMachine({ ...deps, observe: () => deps.observe() }).provide({
		actors: {
			open: createAsyncLogic({ run: f.opened }),
			authorization: createAsyncLogic({ run: f.authorized }),
			history: createAsyncLogic({ run: f.history }),
			accounts: createAsyncLogic({ run: async (): Promise<SyncAccountResult[]> => [] }),
			rollback: createAsyncLogic({ run: f.rollback }),
			stage: createAsyncLogic({ run: f.stage })
		}
	})
	expect(await toPromise(createActor(logic, { input: { scope } }).start())).toMatchObject({
		kind: 'deferred',
		settlement: 'notStarted'
	})
	expect(f.stage).not.toHaveBeenCalled()
	expect(f.rollback).toHaveBeenCalledOnce()
})
it('cancellation drains an issued commit and reports the actual confirmed deletion', async () => {
	const f = fixture(),
		pending = Promise.withResolvers<void>()
	f.settle.mockReturnValue(pending.promise)
	const actor = createActor(f.logic, { input: { scope } }).start()
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'settling' } }))
	actor.send({ type: 'CANCEL' })
	expect(actor.getSnapshot().status).toBe('active')
	pending.resolve()
	expect(await toPromise(actor)).toEqual({
		kind: 'cancelled',
		deletedCount: 1,
		settlement: 'confirmed'
	})
	expect(f.rollback).not.toHaveBeenCalled()
})
it('reports unresolved settlement without claiming deletion or rolling back an issued commit', async () => {
	const f = fixture()
	f.settle.mockImplementation(() => new Promise(() => {}))
	expect(await toPromise(createActor(f.logic, { input: { scope } }).start())).toEqual({
		kind: 'deferred',
		deletedCount: 0,
		settlement: 'unresolved'
	})
	expect(f.commit).toHaveBeenCalledOnce()
	expect(f.rollback).not.toHaveBeenCalled()
})
it('does not stage deletion when history is within the cap', async () => {
	const f = fixture()
	f.history.mockResolvedValue(Array.from({ length: 100 }, () => row))
	expect(await toPromise(createActor(f.logic, { input: { scope } }).start())).toMatchObject({
		kind: 'unchanged',
		deletedCount: 0
	})
	expect(f.stage).not.toHaveBeenCalled()
	expect(f.opened).not.toHaveBeenCalled()
	expect(f.rollback).not.toHaveBeenCalled()
})
it('reports stage failure after rolling back the whole bundle', async () => {
	const f = fixture()
	f.stage.mockRejectedValue(new Error('delete unavailable'))
	expect(await toPromise(createActor(f.logic, { input: { scope } }).start())).toMatchObject({
		kind: 'deferred',
		deletedCount: 0
	})
	expect(f.rollback).toHaveBeenCalledOnce()
	expect(f.commit).not.toHaveBeenCalled()
})
it('coordinator drains a prior scope before replacement and shutdown', async () => {
	const f = fixture(),
		pending = Promise.withResolvers<ReturnType<typeof resource>>()
	f.opened.mockReturnValueOnce(pending.promise)
	const actor = createActor(
		createSyncLogRetentionCoordinator(f.deps).provide({ actors: { retention: f.logic } })
	).start()
	actor.send({ type: 'CHECK', scope, completion: undefined })
	await vi.waitFor(() => expect(f.opened).toHaveBeenCalledOnce())
	actor.send({ type: 'CHECK', scope: { ...scope, connectionId: id(99) }, completion: undefined })
	expect(f.opened).toHaveBeenCalledOnce()
	pending.resolve(f.tx)
	await waitFor(actor, (snapshot) => snapshot.matches('idle'))
	expect(f.opened).toHaveBeenCalledTimes(2)
	expect(f.rollback).toHaveBeenCalledOnce()
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('done')
})
it('coordinator retries deferred cleanup and stays idle offline', async () => {
	vi.useFakeTimers()
	const f = fixture()
	f.authorized.mockResolvedValue(false)
	const actor = createActor(
		createSyncLogRetentionCoordinator(f.deps).provide({ actors: { retention: f.logic } })
	).start()
	actor.send({ type: 'CHECK', scope, completion: undefined })
	await vi.advanceTimersByTimeAsync(1)
	expect(f.authorized).toHaveBeenCalledOnce()
	await vi.advanceTimersByTimeAsync(60_000)
	expect(f.authorized).toHaveBeenCalledTimes(2)
	actor.send({ type: 'CHECK', scope: undefined, completion: undefined })
	await vi.advanceTimersByTimeAsync(120_000)
	expect(f.authorized).toHaveBeenCalledTimes(2)
	actor.send({ type: 'SHUTDOWN' })
})

it('rolls back when local attempt coverage differs from the authoritative snapshot', async () => {
	const f = fixture()
	f.history
		.mockResolvedValueOnce(
			Array.from({ length: 101 }, (_, index) => ({ ...row, id: id(index + 10) }))
		)
		.mockResolvedValueOnce([row])
	expect(await toPromise(createActor(f.logic, { input: { scope } }).start())).toMatchObject({
		kind: 'deferred',
		deletedCount: 0
	})
	expect(f.rollback).toHaveBeenCalledOnce()
	expect(f.stage).not.toHaveBeenCalled()
})
it('rolls back when local account coverage differs from the authoritative snapshot', async () => {
	const f = fixture()
	f.accounts
		.mockResolvedValueOnce([
			{
				id: id(999),
				organizationId: scope.organizationId,
				attemptId: id(110),
				accountId: id(4),
				accountName: 'Checking',
				outcome: 'succeeded',
				importedCount: 0,
				existingCount: 0,
				omittedCount: 0,
				failureCode: null
			}
		])
		.mockResolvedValueOnce([])
	expect(await toPromise(createActor(f.logic, { input: { scope } }).start())).toMatchObject({
		kind: 'deferred',
		deletedCount: 0
	})
	expect(f.rollback).toHaveBeenCalledOnce()
	expect(f.stage).not.toHaveBeenCalled()
})
it('rolls back when an authority-confirmed snapshot cannot be rechecked locally', async () => {
	const f = fixture()
	f.history
		.mockResolvedValueOnce(
			Array.from({ length: 101 }, (_, index) => ({ ...row, id: id(index + 10) }))
		)
		.mockImplementation(() => new Promise(() => {}))
	expect(await toPromise(createActor(f.logic, { input: { scope } }).start())).toMatchObject({
		kind: 'deferred',
		deletedCount: 0
	})
	expect(f.rollback).toHaveBeenCalledOnce()
	expect(f.stage).not.toHaveBeenCalled()
})

it('coordinator releases an idle lifetime without running a transaction', () => {
	const f = fixture()
	const actor = createActor(createSyncLogRetentionCoordinator(f.deps)).start()
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().output).toEqual({ outcome: 'released' })
	expect(f.opened).not.toHaveBeenCalled()
})
it.each(['normal', 'replacement', 'shutdown'])(
	'coordinator preserves unresolved commit settlement during %s',
	async (intent) => {
		const f = fixture()
		const pending = Promise.withResolvers<void>()
		f.settle.mockReturnValueOnce(pending.promise)
		const actor = createActor(
			createSyncLogRetentionCoordinator(f.deps).provide({ actors: { retention: f.logic } })
		).start()
		actor.send({ type: 'CHECK', scope, completion: undefined })
		const cleanup = actor.getSnapshot().children.retention
		if (!cleanup) throw new Error('Missing retention transaction owner')
		await waitFor(cleanup, (snapshot) => snapshot.matches({ running: { work: 'settling' } }))
		expect(f.settle).toHaveBeenCalledOnce()
		if (intent === 'replacement')
			actor.send({ type: 'CHECK', scope: undefined, completion: undefined })
		if (intent === 'shutdown') actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().output).toBeUndefined()
		pending.reject(new Error('settlement unavailable'))
		if (intent !== 'shutdown') {
			await waitFor(actor, (snapshot) => snapshot.matches('idle'))
			actor.send({ type: 'SHUTDOWN' })
		}
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(actor.getSnapshot().output).toEqual({ outcome: 'unresolved' })
	}
)
it('coordinator keeps uncertainty after a successful later cleanup', async () => {
	const f = fixture()
	f.settle.mockRejectedValueOnce(new Error('first settlement unavailable'))
	const actor = createActor(
		createSyncLogRetentionCoordinator(f.deps).provide({ actors: { retention: f.logic } })
	).start()
	actor.send({ type: 'CHECK', scope, completion: 'first' })
	await waitFor(actor, (snapshot) => snapshot.matches('idle'))
	actor.send({ type: 'CHECK', scope, completion: 'next' })
	await waitFor(actor, (snapshot) => snapshot.matches('idle'))
	expect(f.settle).toHaveBeenCalledTimes(2)
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().output).toEqual({ outcome: 'unresolved' })
})
it.each(['normal', 'replacement', 'shutdown'])(
	'coordinator retains a transaction child crash during %s',
	async (intent) => {
		const f = fixture()
		const pending = Promise.withResolvers<ReturnType<typeof resource>>()
		f.opened.mockReturnValueOnce(pending.promise)
		let broken = false
		const logic = f.logic.provide({
			guards: {
				interrupted: () => {
					if (broken) throw new Error('controlled child crash')
					return false
				}
			}
		})
		const actor = createActor(
			createSyncLogRetentionCoordinator(f.deps).provide({ actors: { retention: logic } })
		).start()
		actor.send({ type: 'CHECK', scope, completion: undefined })
		await vi.waitFor(() => expect(f.opened).toHaveBeenCalledOnce())
		if (intent === 'replacement')
			actor.send({ type: 'CHECK', scope: undefined, completion: undefined })
		if (intent === 'shutdown') actor.send({ type: 'SHUTDOWN' })
		broken = true
		pending.resolve(f.tx)
		if (intent !== 'shutdown') {
			await waitFor(actor, (snapshot) => snapshot.matches('idle'))
			actor.send({ type: 'SHUTDOWN' })
		}
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(actor.getSnapshot().output).toEqual({ outcome: 'unresolved' })
	}
)
