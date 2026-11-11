import { afterEach, expect, it, vi } from 'vitest'
import { createSyncLogMachine } from './sync-log.js'
import type { Dependencies } from './types.js'
import type {
	SyncLogCompletion,
	SyncLogParentEvent,
	SyncLogStart,
	SyncLogAccountResult
} from '#lib/contracts/bank-sync-log.js'
import {
	createActor,
	setup,
	types,
	type ActorRefFrom,
	createCallbackLogic,
	toPromise,
	waitFor,
	createAsyncLogic
} from 'xstate'
import type { AnyActorRef } from 'xstate'

const actors: { stop: () => void }[] = []
type AccountWrite = {
	id: string
	values: SyncLogAccountResult & { attemptId: string; organizationId: string }
}
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
})
const input: SyncLogStart = {
	id: crypto.randomUUID(),
	organizationId: crypto.randomUUID(),
	connectionId: crypto.randomUUID(),
	initiatedBy: crypto.randomUUID(),
	startedAt: new Date('2026-10-30T12:00:00Z')
}
const result: SyncLogCompletion = {
	outcome: 'partial',
	finishedAt: new Date('2026-10-30T12:01:00Z'),
	importSettlement: 'locallyPersisted',
	failureCode: null,
	importedCount: 1,
	existingCount: 2,
	omittedCount: 3
}
function start(
	options: {
		begin?: () => Promise<void>
		finish?: (value: SyncLogCompletion) => Promise<void>
		input?: SyncLogStart
		account?: (write: AccountWrite) => Promise<void>
	} = {}
) {
	const events: SyncLogParentEvent[] = []
	const db = vi.fn<() => Dependencies['db']>()()
	const logic = createSyncLogMachine({ db }).provide({
		actors: {
			recordAccount: createAsyncLogic<void, AccountWrite>({
				run: ({ input }) => options.account?.(input) ?? Promise.resolve()
			}),
			recordStart: createAsyncLogic<void, SyncLogStart>({
				run: () => options.begin?.() ?? Promise.resolve()
			}),
			recordResult: createAsyncLogic<void, { start: SyncLogStart; result: SyncLogCompletion }>({
				run: ({ input }) => options.finish?.(input.result) ?? Promise.resolve()
			})
		}
	})
	const parent = createActor(
		setup({
			actors: { log: logic },
			schemas: {
				children: { log: types<ActorRefFrom<typeof logic>>() },
				events: {
					SYNC_LOG_READY:
						types<Omit<Extract<SyncLogParentEvent, { type: 'SYNC_LOG_READY' }>, 'type'>>()
				}
			}
		}).createMachine({
			invoke: { id: 'log', src: 'log', input: options.input ?? input },
			on: {
				SYNC_LOG_READY: ({ event }, enq) => {
					enq(() => {
						events.push(event)
					})
				}
			}
		})
	)
	const retained: { actor: ActorRefFrom<typeof logic> | undefined } = { actor: undefined }
	const subscription = parent.subscribe((snapshot) => {
		retained.actor ??= snapshot.children.log
	})
	parent.start()
	subscription.unsubscribe()

	actors.push(parent)
	const actor = retained.actor
	if (!actor) throw new Error('Missing supervised sync log')

	return { actor, events }
}
it('reports readiness once and records the supplied financial result', async () => {
	const finish = vi.fn(async (_value: SyncLogCompletion) => {})
	const f = start({ finish })
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	expect(f.events).toEqual([{ type: 'SYNC_LOG_READY', attemptId: input.id }])
	f.actor.send({ type: 'FINISH', result })
	expect(await toPromise(f.actor)).toEqual({ kind: 'recorded', attemptId: input.id, result })
	expect(finish).toHaveBeenCalledExactlyOnceWith(result)
})
it('rejects invalid starts before writing or signalling readiness', async () => {
	const begin = vi.fn(async () => {})
	const f = start({ begin, input: { ...input, organizationId: 'invalid' } })
	expect(await toPromise(f.actor)).toEqual({
		kind: 'notStarted',
		attemptId: input.id,
		reason: 'invalidStart'
	})
	expect(begin).not.toHaveBeenCalled()
	expect(f.events).toEqual([])
})
it('reports a failed start write without enabling provider work', async () => {
	const f = start({
		begin: async () => {
			throw new Error('write')
		}
	})
	expect(await toPromise(f.actor)).toEqual({
		kind: 'notStarted',
		attemptId: input.id,
		reason: 'startWriteFailed'
	})
	expect(f.events).toEqual([])
})
it('drains start persistence before recording cancellation and never signals readiness', async () => {
	const pending = Promise.withResolvers<void>()
	const finish = vi.fn(async (_value: SyncLogCompletion) => {})
	const f = start({ begin: () => pending.promise, finish })
	f.actor.send({ type: 'CANCEL' })
	expect(f.actor.getSnapshot().matches({ recordingStart: 'cancelling' })).toBe(true)
	expect(finish).not.toHaveBeenCalled()
	pending.resolve()
	const done = await toPromise(f.actor)
	expect(done).toMatchObject({
		kind: 'recorded',
		result: { outcome: 'cancelled', importSettlement: 'notStarted', importedCount: null }
	})
	expect(f.events).toEqual([])
})
it('waits for the operation to report its actual result after cancellation', async () => {
	const f = start()
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	f.actor.send({ type: 'CANCEL' })
	expect(f.actor.getSnapshot().matches({ awaitingResult: 'cancelling' })).toBe(true)
	const cancelled: SyncLogCompletion = {
		...result,
		outcome: 'cancelled',
		importSettlement: 'unresolved'
	}
	f.actor.send({ type: 'FINISH', result: cancelled })
	expect(await toPromise(f.actor)).toEqual({
		kind: 'recorded',
		attemptId: input.id,
		result: cancelled
	})
})
it('drains result writes and ignores late replacement results', async () => {
	const pending = Promise.withResolvers<void>()
	const f = start({ finish: () => pending.promise })
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	f.actor.send({ type: 'FINISH', result })
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'FINISH', result: { ...result, importedCount: 999 } })
	expect(f.actor.getSnapshot().matches('recordingResult')).toBe(true)
	pending.resolve()
	expect(await toPromise(f.actor)).toEqual({ kind: 'recorded', attemptId: input.id, result })
})
it('preserves the financial result when completion logging fails', async () => {
	const f = start({
		finish: async () => {
			throw new Error('write')
		}
	})
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	f.actor.send({ type: 'FINISH', result })
	expect(await toPromise(f.actor)).toEqual({
		kind: 'resultUnrecorded',
		attemptId: input.id,
		result,
		reason: 'resultWriteFailed'
	})
})
it('rejects invalid completion times without attempting the terminal write', async () => {
	const finish = vi.fn(async (_value: SyncLogCompletion) => {})
	const f = start({ finish })
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	const invalid = { ...result, finishedAt: new Date('2026-10-29T12:00:00Z') }
	f.actor.send({ type: 'FINISH', result: invalid })
	expect(await toPromise(f.actor)).toEqual({
		kind: 'resultUnrecorded',
		attemptId: input.id,
		result: invalid,
		reason: 'invalidResult'
	})
	expect(finish).not.toHaveBeenCalled()
})

const accountResult: SyncLogAccountResult = {
	accountId: crypto.randomUUID(),
	accountName: 'Checking at sync time',
	outcome: 'succeeded',
	importedCount: 1,
	existingCount: 0,
	omittedCount: 0,
	failureCode: null
}
it('writes account rows before the attempt, with stable IDs scoped to the attempt', async () => {
	const writes: AccountWrite[] = []
	const order: string[] = []
	const account = async (write: AccountWrite) => {
		writes.push(write)
		order.push(write.values.accountName)
	}
	const finish = async () => {
		order.push('finish')
	}
	const accounts = [
		accountResult,
		{ ...accountResult, accountId: crypto.randomUUID(), accountName: 'Savings' }
	]
	const f = start({ account, finish })
	await waitFor(f.actor, (s) => s.matches('awaitingResult'))
	f.actor.send({ type: 'FINISH', result, accounts })
	expect(await toPromise(f.actor)).toMatchObject({ kind: 'recorded' })
	expect(order).toEqual(['Checking at sync time', 'Savings', 'finish'])
	expect(writes.map((write) => write.values)).toEqual(
		accounts.map((row) => ({ ...row, attemptId: input.id, organizationId: input.organizationId }))
	)
	expect(writes[0]?.id).not.toBe(writes[1]?.id)
	const again = start({ account })
	await waitFor(again.actor, (s) => s.matches('awaitingResult'))
	again.actor.send({ type: 'FINISH', result, accounts })
	await toPromise(again.actor)
	expect(writes[2]?.id).toBe(writes[0]?.id)
	const another = start({ account, input: { ...input, id: crypto.randomUUID() } })
	await waitFor(another.actor, (s) => s.matches('awaitingResult'))
	another.actor.send({ type: 'FINISH', result, accounts: [accountResult] })
	await toPromise(another.actor)
	expect(writes[4]?.id).not.toBe(writes[0]?.id)
})
it.each(['duplicate', 'invalid'])(
	'rejects %s account results before issuing any account writes',
	async (kind) => {
		const account = vi.fn(async (_write: AccountWrite) => {})
		const finish = vi.fn(async () => {})
		const f = start({ account, finish })
		await waitFor(f.actor, (s) => s.matches('awaitingResult'))
		f.actor.send({
			type: 'FINISH',
			result,
			accounts:
				kind === 'duplicate'
					? [accountResult, accountResult]
					: [{ ...accountResult, importedCount: -1 }]
		})
		expect(await toPromise(f.actor)).toMatchObject({
			kind: 'resultUnrecorded',
			reason: 'invalidResult',
			result
		})
		expect(account).not.toHaveBeenCalled()
		expect(finish).not.toHaveBeenCalled()
	}
)
it('leaves the attempt unfinished when an account write fails and preserves the financial result', async () => {
	const finish = vi.fn(async () => {})
	const f = start({
		account: async () => {
			throw new Error('account write')
		},
		finish
	})
	await waitFor(f.actor, (s) => s.matches('awaitingResult'))
	f.actor.send({ type: 'FINISH', result, accounts: [accountResult] })
	expect(await toPromise(f.actor)).toEqual({
		kind: 'resultUnrecorded',
		attemptId: input.id,
		result,
		reason: 'accountWriteFailed'
	})
	expect(finish).not.toHaveBeenCalled()
})
it('drains an account write through cancellation before completing the attempt', async () => {
	const pending = Promise.withResolvers<void>()
	const account = vi.fn((_write: AccountWrite) => pending.promise)
	const finish = vi.fn(async () => {})
	const f = start({ account, finish })
	await waitFor(f.actor, (s) => s.matches('awaitingResult'))
	f.actor.send({ type: 'FINISH', result, accounts: [accountResult] })
	await waitFor(f.actor, (s) => s.matches('recordingAccount'))
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'FINISH', result: { ...result, importedCount: 99 }, accounts: [] })
	expect(finish).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().status).toBe('active')
	pending.resolve()
	expect(await toPromise(f.actor)).toEqual({ kind: 'recorded', attemptId: input.id, result })
	expect(account).toHaveBeenCalledOnce()
	expect(finish).toHaveBeenCalledExactlyOnceWith(result)
})
