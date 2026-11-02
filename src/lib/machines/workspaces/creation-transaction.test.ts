import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { createWorkspaceCreationTransaction } from './creation-transaction.js'
import type {
	WorkspaceCreationAttempt,
	WorkspaceCreationTransactionCapability
} from '../../contracts/workspace-creation.js'

type Work =
	| 'opening'
	| 'readingLocal'
	| 'staging'
	| 'committing'
	| 'persistingLocal'
	| 'rollingBack'
type Draft = { name: string }
type Transaction = { token: object }
type Records = { exists: boolean }
type Workspace = { id: string }
type Write = { token: object }
type Capability = WorkspaceCreationTransactionCapability<
	Draft,
	Transaction,
	Records,
	Workspace,
	Write
>
const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function deferred<Value>() {
	let resolve!: (value: Value) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<Value>((accept, fail) => {
		resolve = accept
		reject = fail
	})
	return { promise, resolve, reject }
}
function fixture() {
	const attempt: WorkspaceCreationAttempt<Draft> = {
		operationId: 'operation',
		workspaceId: 'workspace',
		membershipId: 'membership',
		draft: { name: 'Private workspace' }
	}
	const transaction: Transaction = { token: {} }
	const records: Records = { exists: false }
	const workspace: Workspace = { id: attempt.workspaceId }
	const write: Write = { token: {} }
	const capability = {
		open: vi.fn<Capability['open']>(() => transaction),
		readLocal: vi.fn<Capability['readLocal']>(() => records),
		assess: vi.fn<Capability['assess']>(() => ({ outcome: 'eligible' })),
		stage: vi.fn<Capability['stage']>(() => workspace),
		commit: vi.fn<Capability['commit']>(() => write),
		persistLocal: vi.fn<Capability['persistLocal']>(() => undefined),
		rollback: vi.fn<Capability['rollback']>(() => true)
	}
	const actor = createActor(
		createWorkspaceCreationTransaction<Draft, Transaction, Records, Workspace, Write>(capability),
		{
			input: { attempt }
		}
	)
	actors.add(actor)
	return {
		actor,
		capability,
		attempt,
		transaction,
		records,
		workspace,
		write,
		start: () => actor.start(),
		at: (work: Work) => waitFor(actor, (s) => s.matches({ running: { work } }), { timeout: 1_000 }),
		done: async () => (await waitFor(actor, (s) => s.status === 'done', { timeout: 1_000 })).output
	}
}

describe('private workspace creation transaction ownership', () => {
	it('keeps one transaction and attempt through local eligibility, staging, commit and persistence', async () => {
		const f = fixture()
		f.start()
		expect(await f.done()).toEqual({
			attempt: f.attempt,
			outcome: 'succeeded',
			settlement: { kind: 'locallyPersisted', workspace: f.workspace }
		})
		expect(f.capability.readLocal).toHaveBeenCalledWith(f.transaction, f.attempt)
		expect(f.capability.assess).toHaveBeenCalledWith(f.records, f.attempt)
		expect(f.capability.stage).toHaveBeenCalledWith(f.transaction, f.attempt)
		expect(f.capability.commit).toHaveBeenCalledExactlyOnceWith(f.transaction)
		expect(f.capability.persistLocal).toHaveBeenCalledExactlyOnceWith(f.write)
		expect(f.capability.rollback).not.toHaveBeenCalled()
	})
	it('does not report persistence before the local durability operation settles', async () => {
		const local = deferred<void>()
		const f = fixture()
		f.capability.persistLocal.mockReturnValue(local.promise)
		f.start()
		await f.at('persistingLocal')
		expect(f.actor.getSnapshot().status).toBe('active')
		local.resolve()
		expect((await f.done())?.settlement.kind).toBe('locallyPersisted')
	})
	it('rolls back blocked local eligibility without staging or committing', async () => {
		const f = fixture()
		f.capability.assess.mockReturnValue({ outcome: 'blocked', reason: 'conflict' })
		f.start()
		expect(await f.done()).toEqual({
			attempt: f.attempt,
			outcome: 'blocked',
			reason: 'conflict',
			settlement: { kind: 'notStarted' }
		})
		expect(f.capability.rollback).toHaveBeenCalledExactlyOnceWith(f.transaction)
		expect(f.capability.stage).not.toHaveBeenCalled()
		expect(f.capability.commit).not.toHaveBeenCalled()
	})
	it.each(['open', 'readLocal', 'assess', 'stage'] satisfies (keyof Capability)[])(
		'handles a %s failure before commit without inventing a persisted workspace',
		async (step) => {
			const f = fixture()
			const error = new Error(step)
			f.capability[step].mockImplementation(() => {
				throw error
			})
			f.start()
			expect(await f.done()).toEqual({
				attempt: f.attempt,
				outcome: 'failed',
				error,
				settlement: { kind: 'notStarted' }
			})
			expect(f.capability.rollback).toHaveBeenCalledTimes(step === 'open' ? 0 : 1)
			expect(f.capability.commit).not.toHaveBeenCalled()
		}
	)
	it.each(['commit', 'persistLocal'] satisfies (keyof Capability)[])(
		'retains uncertain settlement after %s fails, even when rollback succeeds',
		async (step) => {
			const f = fixture()
			const error = new Error(step)
			f.capability[step].mockImplementation(() => {
				throw error
			})
			f.start()
			expect(await f.done()).toEqual({
				attempt: f.attempt,
				outcome: 'failed',
				error,
				settlement: { kind: 'unresolved', error }
			})
			expect(f.capability.commit).toHaveBeenCalledTimes(1)
			expect(f.capability.rollback).toHaveBeenCalledExactlyOnceWith(f.transaction)
		}
	)
	for (const type of ['CANCEL', 'SHUTDOWN'] satisfies ('CANCEL' | 'SHUTDOWN')[]) {
		const outcome = type === 'CANCEL' ? 'cancelled' : 'closed'
		it.each(['opening', 'readingLocal', 'staging'] satisfies Work[])(
			`retains acquired resources during ${type} in %s and prevents commit`,
			async (step) => {
				const f = fixture()
				const pending = deferred<void>()
				if (step === 'opening')
					f.capability.open.mockImplementation(async () => {
						await pending.promise
						return f.transaction
					})
				if (step === 'readingLocal')
					f.capability.readLocal.mockImplementation(async () => {
						await pending.promise
						return f.records
					})
				if (step === 'staging')
					f.capability.stage.mockImplementation(async () => {
						await pending.promise
						return f.workspace
					})
				f.start()
				await f.at(step)
				f.actor.send({ type })
				expect(f.actor.getSnapshot().status).toBe('active')
				expect(f.capability.rollback).not.toHaveBeenCalled()
				pending.resolve()
				expect(await f.done()).toEqual({
					attempt: f.attempt,
					outcome,
					settlement: { kind: 'notStarted' }
				})
				expect(f.capability.rollback).toHaveBeenCalledExactlyOnceWith(f.transaction)
				expect(f.capability.commit).not.toHaveBeenCalled()
			}
		)
		it.each(['committing', 'persistingLocal'] satisfies Work[])(
			`drains ${type} during %s through local persistence without replay`,
			async (step) => {
				const f = fixture()
				const pending = deferred<void>()
				if (step === 'committing')
					f.capability.commit.mockImplementation(async () => {
						await pending.promise
						return f.write
					})
				if (step === 'persistingLocal') f.capability.persistLocal.mockReturnValue(pending.promise)
				f.start()
				await f.at(step)
				f.actor.send({ type })
				f.actor.send({ type: 'CANCEL' })
				expect(f.actor.getSnapshot().status).toBe('active')
				pending.resolve()
				expect(await f.done()).toEqual({
					attempt: f.attempt,
					outcome,
					settlement: { kind: 'locallyPersisted', workspace: f.workspace }
				})
				expect(f.capability.commit).toHaveBeenCalledTimes(1)
				expect(f.capability.persistLocal).toHaveBeenCalledTimes(1)
				expect(f.capability.rollback).not.toHaveBeenCalled()
			}
		)
	}
	it('gives shutdown priority during cancellation while rollback remains pending', async () => {
		const f = fixture()
		const pending = deferred<boolean>()
		f.capability.assess.mockReturnValue({ outcome: 'blocked', reason: 'conflict' })
		f.capability.rollback.mockReturnValue(pending.promise)
		f.start()
		await f.at('rollingBack')
		f.actor.send({ type: 'CANCEL' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'CANCEL' })
		expect(f.actor.getSnapshot().status).toBe('active')
		pending.resolve(true)
		expect(await f.done()).toEqual({
			attempt: f.attempt,
			outcome: 'closed',
			settlement: { kind: 'notStarted' }
		})
	})
	it.each(['false', 'reject'])(
		'keeps the attempt unresolved when rollback returns %s',
		async (failure) => {
			const f = fixture()
			f.capability.assess.mockReturnValue({ outcome: 'blocked', reason: 'conflict' })
			if (failure === 'false') f.capability.rollback.mockReturnValue(false)
			else f.capability.rollback.mockRejectedValue(new Error('rollback failed'))
			f.start()
			const result = await f.done()
			expect(result?.outcome).toBe('failed')
			expect(result?.settlement.kind).toBe('unresolved')
			expect(result?.attempt).toBe(f.attempt)
			expect(f.capability.commit).not.toHaveBeenCalled()
		}
	)
})
