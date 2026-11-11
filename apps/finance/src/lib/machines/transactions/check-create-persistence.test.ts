import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { createCheckCreationMachine, type CheckCreationInput } from './check-create-persistence.js'
import { createActor, toPromise, waitFor, createAsyncLogic } from 'xstate'

const input: CheckCreationInput = {
	id: '11111111-1111-4111-8111-111111111111',
	values: {
		organizationId: '22222222-2222-4222-8222-222222222222',
		accountId: '33333333-3333-4333-8333-333333333333',
		checkNumber: ' 101 ',
		checkDate: '2026-10-23'
	}
}
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
})
function fixture() {
	const tx = new Transaction('mergeable', () => {
		throw new Error('Unit fixture must not open a runtime')
	})
	const insert = vi.spyOn(tx, 'insert').mockImplementation(vi.fn())
	const rollback = vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	const wait = vi.fn(async (_options: { tier: 'local' }) => {})
	const commit = vi.spyOn(tx, 'commit').mockImplementation(vi.fn().mockReturnValue({ wait }))
	const beginTransaction = vi.fn(() => tx)
	const machine = createCheckCreationMachine({ beginTransaction })
	function start(
		values = input,
		logic: import('xstate').ActorLogic<
			import('xstate').SnapshotFrom<typeof machine>,
			import('xstate').EventFromLogic<typeof machine>,
			import('xstate').InputFrom<typeof machine>,
			import('xstate').AnyActorSystem,
			import('xstate').EmittedFrom<typeof machine>
		> = machine
	) {
		const actor = createActor(logic, { input: values })
		cleanups.push(() => actor.stop())
		return actor.start()
	}
	return { tx, insert, rollback, wait, commit, beginTransaction, machine, start }
}

describe('Check creation persistence', () => {
	it('creates only the Check with the caller ID and waits for local persistence', async () => {
		const f = fixture()
		const settled = Promise.withResolvers<void>()
		f.wait.mockReturnValue(settled.promise)
		const actor = f.start()
		await waitFor(actor, () => f.wait.mock.calls.length === 1)
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.insert).toHaveBeenCalledExactlyOnceWith(
			app.checks,
			{
				...input.values,
				checkNumber: '101',
				payerName: null,
				bankName: null,
				memoOnCheck: null
			},
			{ id: input.id }
		)
		expect(f.wait).toHaveBeenCalledWith({ tier: 'local' })
		settled.resolve()
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'succeeded',
			checkId: input.id,
			settlement: 'locallyPersisted'
		})
		expect(f.rollback).not.toHaveBeenCalled()
		expect(actor.getSnapshot().context.tx).toBeUndefined()
		expect(actor.getSnapshot().context.handle).toBeUndefined()
	})

	it.each([
		{ ...input, id: 'invalid' },
		{ ...input, values: { ...input.values, checkNumber: ' ' } },
		{ ...input, values: { ...input.values, checkDate: '2026-02-30' } },
		{ ...input, values: { ...input.values, organizationId: 'invalid' } }
	])('rejects invalid input without opening a write: %j', async (values) => {
		const f = fixture()
		await expect(toPromise(f.start(values))).resolves.toMatchObject({
			outcome: 'failed',
			settlement: 'notStarted'
		})
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})

	it('handles transaction acquisition failure without attempting rollback', async () => {
		const f = fixture()
		f.beginTransaction.mockImplementation(() => {
			throw new Error('open failed')
		})
		await expect(toPromise(f.start())).resolves.toEqual({
			outcome: 'failed',
			checkId: input.id,
			settlement: 'notStarted'
		})
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('rolls back a staging failure and waits for cleanup', async () => {
		const f = fixture()
		const cleaned = Promise.withResolvers<boolean>()
		f.insert.mockImplementation(() => {
			throw new Error('stage failed')
		})
		f.rollback.mockReturnValue(cleaned.promise)
		const actor = f.start()
		await waitFor(actor, () => f.rollback.mock.calls.length === 1)
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.commit).not.toHaveBeenCalled()
		cleaned.resolve(true)
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'failed',
			checkId: input.id,
			settlement: 'rejected'
		})
	})

	it.each(['commit', 'settle'] satisfies ('commit' | 'settle')[])(
		'keeps %s failure uncertain even when local rollback returns true',
		async (failure) => {
			const f = fixture()
			if (failure === 'commit')
				f.commit.mockImplementation(() => {
					throw new Error('commit failed')
				})
			else f.wait.mockRejectedValue(new Error('settlement failed'))
			await expect(toPromise(f.start())).resolves.toEqual({
				outcome: 'failed',
				checkId: input.id,
				settlement: 'unknown'
			})
			expect(f.rollback).toHaveBeenCalledTimes(1)
			expect(f.beginTransaction).toHaveBeenCalledTimes(1)
			expect(f.insert).toHaveBeenCalledTimes(1)
		}
	)

	it.each(['false', 'reject'])(
		'reports unknown settlement when rollback cannot confirm cleanup (%s)',
		async (failure) => {
			const f = fixture()
			f.insert.mockImplementation(() => {
				throw new Error('stage failed')
			})
			if (failure === 'false') f.rollback.mockResolvedValue(false)
			else f.rollback.mockRejectedValue(new Error('rollback failed'))
			await expect(toPromise(f.start())).resolves.toMatchObject({
				outcome: 'failed',
				settlement: 'unknown'
			})
		}
	)
})

describe('Check creation interruptions', () => {
	it('cancels before persistence without opening a transaction', async () => {
		const f = fixture()
		const actor = f.start()
		actor.send({ type: 'CANCEL' })
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'cancelled',
			checkId: input.id,
			settlement: 'notStarted'
		})
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})

	it('drains acquisition but stages nothing when scope changes before staging', async () => {
		const f = fixture()
		const opened = Promise.withResolvers<typeof f.tx>()
		const actor = f.start(
			input,
			f.machine.provide({ actors: { open: createAsyncLogic({ run: () => opened.promise }) } })
		)
		await waitFor(actor, (s) => s.matches({ running: { flow: 'opening' } }))
		actor.send({ type: 'INVALIDATE' })
		expect(actor.getSnapshot().status).toBe('active')
		opened.resolve(f.tx)
		await expect(toPromise(actor)).resolves.toMatchObject({
			outcome: 'scopeChanged',
			settlement: 'rejected'
		})
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})

	it('rolls back after an issued stage settles instead of committing on cancellation', async () => {
		const f = fixture()
		const staged = Promise.withResolvers<void>()
		const actor = f.start(
			input,
			f.machine.provide({ actors: { stage: createAsyncLogic({ run: () => staged.promise }) } })
		)
		await waitFor(actor, (s) => s.matches({ running: { flow: 'staging' } }))
		actor.send({ type: 'CANCEL' })
		expect(f.rollback).not.toHaveBeenCalled()
		staged.resolve()
		await expect(toPromise(actor)).resolves.toMatchObject({
			outcome: 'cancelled',
			settlement: 'rejected'
		})
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})

	it.each([
		{ type: 'CANCEL', outcome: 'cancelled' },
		{ type: 'INVALIDATE', outcome: 'scopeChanged' },
		{ type: 'SHUTDOWN', outcome: 'closed' }
	] satisfies { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN'; outcome: string }[])(
		'drains local settlement after $type and retains the persisted Check result',
		async ({ type, outcome }) => {
			const f = fixture()
			const settled = Promise.withResolvers<void>()
			f.wait.mockReturnValue(settled.promise)
			const actor = f.start()
			await waitFor(actor, () => f.wait.mock.calls.length === 1)
			actor.send({ type })
			expect(actor.getSnapshot().status).toBe('active')
			settled.resolve()
			await expect(toPromise(actor)).resolves.toEqual({
				outcome,
				checkId: input.id,
				settlement: 'locallyPersisted'
			})
			expect(f.rollback).not.toHaveBeenCalled()
		}
	)

	it('preserves shutdown over late invalidation, cancellation, and write failure', async () => {
		const f = fixture()
		const settled = Promise.withResolvers<void>()
		f.wait.mockReturnValue(settled.promise)
		const actor = f.start()
		await waitFor(actor, () => f.wait.mock.calls.length === 1)
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'INVALIDATE' })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'INVALIDATE' })
		actor.send({ type: 'CANCEL' })
		settled.reject(new Error('late failure'))
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'closed',
			checkId: input.id,
			settlement: 'unknown'
		})
	})
})
