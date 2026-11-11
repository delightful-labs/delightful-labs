import { publishBankSource } from './reports.fixture.js'
import { describe, expect, it, vi } from 'vitest'
import { importFixture, response, raw, accounts } from './import.fixture.js'
import { id } from './test-fixtures.js'
import type { BankCommand } from './types.js'
import { toPromise, waitFor } from 'xstate'

const counts = (imported = 0, existing = 0, omitted = 0) => ({ imported, existing, omitted })

describe('individual import write settlement', () => {
	it.each(['resolve', 'reject'])(
		'awaits an issued insert on cancellation and %s',
		async (outcome) => {
			const f = importFixture()
			const pending = Promise.withResolvers<void>()
			f.persist.mockReturnValueOnce(pending.promise)
			const actor = f.startTransaction()
			await waitFor(actor, (s) => s.matches({ persisting: 'working' }))
			actor.send({ type: 'CANCEL' })
			actor.send({ type: 'CANCEL' })
			expect(actor.getSnapshot().status).toBe('active')
			expect(f.persist.mock.calls[0]?.[1].aborted).toBe(false)
			const error = new Error('uncertain local write')
			if (outcome === 'resolve') pending.resolve()
			else pending.reject(error)
			expect(await toPromise(actor)).toEqual({
				kind: 'cancelled',
				settlement: outcome === 'resolve' ? 'locallyPersisted' : 'unresolved',
				error: outcome === 'resolve' ? undefined : error
			})
			expect(f.persist).toHaveBeenCalledOnce()
		}
	)
	it('reports a rejected local wait as unresolved rather than an omitted transaction', async () => {
		const f = importFixture()
		const error = new Error('local settlement failed')
		f.persist.mockRejectedValueOnce(error)
		expect(await toPromise(f.startTransaction())).toEqual({ kind: 'unresolved', error })
		expect(f.persist).toHaveBeenCalledOnce()
	})
	it('cancels a pending lookup and ignores its late result without inserting', async () => {
		const f = importFixture()
		const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.lookup>>>()
		f.lookup.mockReturnValueOnce(pending.promise)
		const actor = f.startTransaction()
		await waitFor(actor, (s) => s.matches('findingExisting'))
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toEqual({
			kind: 'cancelled',
			settlement: 'notStarted',
			error: undefined
		})
		pending.resolve([])
		await pending.promise
		expect(f.persist).not.toHaveBeenCalled()
	})
	it.each([1, 2])(
		'cancels during authorization query %s before persistence starts',
		async (query) => {
			const f = importFixture()
			const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.membership>>>()
			// Query 1 authorizes lookup; query 2 rechecks authority before inserting.
			const allowed = await f.membership()
			f.membership.mockClear()
			if (query === 2) f.membership.mockResolvedValueOnce(allowed)
			f.membership.mockReturnValueOnce(pending.promise)
			const actor = f.startTransaction()
			await vi.waitFor(() => expect(f.membership).toHaveBeenCalledTimes(query))
			actor.send({ type: 'CANCEL' })
			expect(await toPromise(actor)).toEqual({
				kind: 'cancelled',
				settlement: 'notStarted',
				error: undefined
			})
			pending.resolve(allowed)
			await pending.promise
			expect(f.persist).not.toHaveBeenCalled()
		}
	)
})

describe('operation/import/account/transaction ownership chain', () => {
	it('imports across accounts and reuses the same stable identities on an explicit second sync', async () => {
		const f = importFixture()
		const first = f.start()
		expect(await toPromise(first.operation)).toMatchObject({
			kind: 'complete',
			counts: counts(3),
			accountResults: accounts.map((account, index) => ({
				account: { id: account.id, name: account.name },
				kind: 'complete',
				counts: counts(index === 0 ? 1 : 2),
				settlement: 'settled'
			})),
			settlement: 'settled'
		})
		expect(f.stored.size).toBe(3)
		expect(f.saveBalanceSnapshot).toHaveBeenCalledTimes(2)
		expect(f.saveBalanceSnapshot).toHaveBeenNthCalledWith(1, {
			linkId: id(20),
			availableBalance: '90.00',
			balanceDate: new Date(1792000000 * 1000)
		})
		expect(f.saveBalanceSnapshot).toHaveBeenNthCalledWith(2, {
			linkId: id(21),
			availableBalance: '250.00',
			balanceDate: new Date(1792000000 * 1000)
		})
		const second = f.start()
		expect(await toPromise(second.operation)).toMatchObject({
			kind: 'complete',
			counts: counts(0, 3),
			accountResults: accounts.map((account, index) => ({
				account: { id: account.id, name: account.name },
				kind: 'complete',
				counts: counts(0, index === 0 ? 1 : 2),
				settlement: 'settled'
			})),
			settlement: 'settled'
		})
		expect(f.persist).toHaveBeenCalledTimes(3)
		expect(f.fetch).toHaveBeenCalledTimes(2)
		expect(f.outcome.mock.calls.map(([input]) => input.counts)).toEqual([counts(3), counts(0, 3)])
		expect(f.release).toHaveBeenCalledTimes(2)
	})
	it.each(['resolve', 'reject'])(
		'keeps final counts and the lock through a cancelled insert that will %s',
		async (outcome) => {
			const f = importFixture()
			const pending = Promise.withResolvers<void>()
			f.persist.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise)
			const { bank, operation } = f.start()
			await vi.waitFor(() => expect(f.persist).toHaveBeenCalledTimes(2))
			expect(bank.getSnapshot().context.counts).toEqual(counts(1))
			bank.send({ type: 'CANCEL' })
			operation.send({ type: 'LOCK_FAILED', error: new Error('late lock failure') })
			expect(operation.getSnapshot().status).toBe('active')
			expect(operation.getSnapshot().context).toMatchObject({
				response: undefined,
				accessUrl: undefined
			})
			expect(f.release).not.toHaveBeenCalled()
			expect(f.persist.mock.calls[1]?.[1].aborted).toBe(false)
			if (outcome === 'resolve') pending.resolve()
			else pending.reject(new Error('local write uncertainty'))
			const expected = outcome === 'resolve' ? counts(2) : counts(1)
			expect(await toPromise(operation)).toMatchObject({
				kind: 'cancelled',
				counts: expected,
				accountResults: [
					{
						account: { id: accounts[0]?.id, name: accounts[0]?.name },
						kind: 'complete',
						counts: counts(1),
						settlement: 'settled'
					},
					{
						account: { id: accounts[1]?.id, name: accounts[1]?.name },
						kind: 'cancelled',
						counts: counts(outcome === 'resolve' ? 1 : 0),
						settlement: outcome === 'resolve' ? 'settled' : 'unresolved'
					}
				],
				settlement: outcome === 'resolve' ? 'settled' : 'unresolved'
			})
			await waitFor(bank, (s) => s.matches({ ready: 'cancelled' }))
			expect(bank.getSnapshot().context.counts).toEqual(expected)
			expect(f.persist).toHaveBeenCalledTimes(2)
			expect(f.loadAccount).toHaveBeenCalledTimes(2)
			expect(f.outcome).not.toHaveBeenCalled()
			expect(f.fetch).toHaveBeenCalledOnce()
			expect(f.release).toHaveBeenCalledOnce()
		}
	)
	it('does not start the next account when cancellation interrupts the first account insert', async () => {
		const f = importFixture()
		const pending = Promise.withResolvers<void>()
		f.persist.mockReturnValueOnce(pending.promise)
		const { bank, operation } = f.start()
		await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
		bank.send({ type: 'CANCEL' })
		pending.resolve()
		expect(await toPromise(operation)).toMatchObject({ kind: 'cancelled', counts: counts(1) })
		expect(f.loadAccount).toHaveBeenCalledOnce()
		expect(f.persist).toHaveBeenCalledOnce()
		expect(f.release).toHaveBeenCalledOnce()
	})
	it.each(['mappings', 'categories', 'account'])(
		'cancels during the %s read without starting an insert',
		async (stage) => {
			const f = importFixture()
			const entered = Promise.withResolvers<void>()
			const gate = Promise.withResolvers<void>()
			if (stage === 'mappings')
				f.mappings.mockImplementationOnce(async () => {
					entered.resolve()
					await gate.promise
					return []
				})
			if (stage === 'categories')
				f.loadCategories.mockImplementationOnce(async () => {
					entered.resolve()
					await gate.promise
					return []
				})
			if (stage === 'account')
				f.loadAccount.mockImplementationOnce(async () => {
					entered.resolve()
					await gate.promise
					return []
				})
			const { bank, operation } = f.start()
			await entered.promise
			bank.send({ type: 'CANCEL' })
			expect(await toPromise(operation)).toMatchObject({
				kind: 'cancelled',
				counts: counts(),
				settlement: 'settled'
			})
			gate.resolve()
			await gate.promise
			expect(f.persist).not.toHaveBeenCalled()
			expect(f.outcome).not.toHaveBeenCalled()
			expect(f.release).toHaveBeenCalledOnce()
		}
	)
	it.each([false, true])(
		'waits after lock failure; later cancellation takes precedence: %s',
		async (cancel) => {
			const f = importFixture()
			const pending = Promise.withResolvers<void>()
			f.persist.mockReturnValueOnce(pending.promise)
			const { bank, operation } = f.start()
			await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
			operation.send({ type: 'LOCK_FAILED', error: new Error('locking_unavailable') })
			if (cancel) bank.send({ type: 'CANCEL' })
			expect(f.release).not.toHaveBeenCalled()
			pending.resolve()
			expect(await toPromise(operation)).toMatchObject({
				kind: cancel ? 'cancelled' : 'failed',
				counts: counts(1),
				error: new Error('locking_unavailable')
			})
			expect(f.outcome).not.toHaveBeenCalled()
			expect(f.release).toHaveBeenCalledOnce()
		}
	)
	it('retains uncertain import settlement after a failure-history write succeeds', async () => {
		const f = importFixture()
		const error = new Error('uncertain transaction insert')
		f.persist.mockRejectedValueOnce(error)
		const { operation } = f.start()
		expect(await toPromise(operation)).toMatchObject({
			kind: 'failed',
			error,
			counts: counts(),
			settlement: 'unresolved'
		})
		expect(f.outcome).toHaveBeenCalledOnce()
		expect(f.outcome.mock.calls[0]?.[0].outcome).toEqual({
			lastOutcome: 'failed',
			lastError: 'operation-failed'
		})
		expect(f.persist).toHaveBeenCalledOnce()
		expect(f.release).toHaveBeenCalledOnce()
	})
	it('counts omissions once and persists the same partial outcome that it returns', async () => {
		const f = importFixture()
		const first = response.accounts[0]
		if (!first) throw new Error('Expected provider fixture')
		f.fetch.mockResolvedValueOnce({
			...response,
			accounts: [
				{
					...first,
					transactions: [{ ...raw('pending'), pending: true }, ...(first.transactions ?? [])]
				},
				...response.accounts.slice(1)
			]
		})
		const { operation } = f.start()
		expect(await toPromise(operation)).toMatchObject({
			kind: 'partial',
			counts: counts(3, 0, 1),
			settlement: 'settled'
		})
		expect(f.outcome.mock.calls[0]?.[0]).toMatchObject({
			counts: counts(3, 0, 1),
			outcome: { lastOutcome: 'partial', lastError: null }
		})
	})
	it.each(['reset', 'shutdown'])(
		'waits for the original-scope insert and ignores stale progress during %s',
		async (intent) => {
			const f = importFixture()
			const pending = Promise.withResolvers<void>()
			f.persist.mockReturnValueOnce(pending.promise)
			const { bank, operation } = f.start()
			await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
			if (intent === 'reset') {
				const replacement = { ...f.initialSource, organizationId: id(99), membership: null }
				f.read.mockReturnValue(replacement)
				publishBankSource(bank, replacement, 1)
			} else bank.send({ type: 'SHUTDOWN' })
			const before = bank.getSnapshot().context.counts
			bank.send({ type: 'IMPORT_PROGRESS', counts: counts(99, 99, 99) })
			bank.send({ type: 'CANCEL' })
			if (intent === 'shutdown') bank.send({ type: 'RESET' })
			expect(bank.getSnapshot().context.counts).toEqual(before)
			expect(f.release).not.toHaveBeenCalled()
			expect(f.persist.mock.calls[0]?.[0].values.organizationId).toBe(id(2))
			pending.resolve()
			expect(await toPromise(operation)).toMatchObject({
				kind: 'cancelled',
				counts: counts(1),
				settlement: 'settled'
			})
			await waitFor(bank, (s) =>
				intent === 'shutdown' ? s.status === 'done' : s.matches({ ready: 'neutral' })
			)
			expect(bank.getSnapshot().context.counts).toEqual(counts())
			expect(f.fetch).toHaveBeenCalledOnce()
			expect(f.persist).toHaveBeenCalledOnce()
			expect(f.release).toHaveBeenCalledOnce()
		}
	)
	it('finishes cancellation after an import actor crash before acquisition without requesting another acknowledgement', async () => {
		const f = importFixture()
		const read = Promise.withResolvers<Awaited<ReturnType<typeof f.mappings>>>()
		f.mappings.mockReturnValueOnce(read.promise)
		const transition = f.imports.transition.bind(f.imports)
		vi.spyOn(f.imports, 'transition').mockImplementation((snapshot, event, scope) => {
			if (event.type === 'CANCEL') throw new Error('observer crashed')
			return transition(snapshot, event, scope)
		})
		const { bank, operation } = f.start()
		await vi.waitFor(() => expect(f.mappings).toHaveBeenCalledOnce())
		bank.send({ type: 'CANCEL' })
		expect(await toPromise(operation)).toMatchObject({
			kind: 'cancelled',
			settlement: 'unresolved'
		})
		read.resolve([])
		await read.promise
		expect(f.persist).not.toHaveBeenCalled()
		expect(f.release).toHaveBeenCalledOnce()
	})
})

const writes: {
	name: string
	command: BankCommand
	outcome: 'succeeded' | 'partial' | 'failed' | 'disconnect'
}[] = [
	{ name: 'disconnect', command: { type: 'DISCONNECT' }, outcome: 'disconnect' },
	{ name: 'complete history', command: { type: 'SYNC' }, outcome: 'succeeded' },
	{ name: 'partial history', command: { type: 'SYNC' }, outcome: 'partial' },
	{ name: 'failure history', command: { type: 'SYNC' }, outcome: 'failed' }
]
describe('disconnect and chosen-outcome write settlement', () => {
	it.each(writes.flatMap((write) => ['resolve', 'reject'].map((result) => ({ ...write, result }))))(
		'retains the lock for cancelled $name until the write will $result',
		async ({ command, outcome, result }) => {
			const f = importFixture()
			const pending = Promise.withResolvers<void>()
			if (outcome === 'disconnect') f.disconnect.mockReturnValueOnce(pending.promise)
			else f.outcome.mockReturnValueOnce(pending.promise)
			if (outcome === 'partial')
				f.fetch.mockResolvedValueOnce({ ...response, errors: ['Synthetic warning'] })
			if (outcome === 'failed') f.fetch.mockRejectedValueOnce(new Error('synthetic provider error'))
			const { bank, operation } = f.start(command)
			await vi.waitFor(() =>
				expect(outcome === 'disconnect' ? f.disconnect : f.outcome).toHaveBeenCalledOnce()
			)
			bank.send({ type: 'CANCEL' })
			operation.send({ type: 'LOCK_FAILED', error: new Error('late lock error') })
			expect(operation.getSnapshot().status).toBe('active')
			expect(f.release).not.toHaveBeenCalled()
			const calls = outcome === 'disconnect' ? f.disconnect.mock.calls : f.outcome.mock.calls
			expect(calls[0]?.[1].aborted).toBe(false)
			if (outcome !== 'disconnect')
				expect(f.outcome.mock.calls[0]?.[0].outcome.lastOutcome).toBe(outcome)
			if (result === 'resolve') pending.resolve()
			else pending.reject(new Error('write settlement failed'))
			expect(await toPromise(operation)).toMatchObject({
				kind: 'cancelled',
				settlement: result === 'resolve' ? 'settled' : 'unresolved'
			})
			expect(f.release).toHaveBeenCalledOnce()
			expect(outcome === 'disconnect' ? f.disconnect : f.outcome).toHaveBeenCalledOnce()
			expect(f.fetch).toHaveBeenCalledTimes(outcome === 'disconnect' ? 0 : 1)
		}
	)
	it('retains a provider failure when its failure-history write rejects', async () => {
		const f = importFixture()
		f.fetch.mockRejectedValueOnce(new Error('unsafe provider detail'))
		f.outcome.mockRejectedValueOnce(new Error('history failed'))
		const { operation } = f.start()
		expect(await toPromise(operation)).toMatchObject({
			kind: 'failed',
			error: new Error('provider_failure'),
			settlement: 'unresolved'
		})
		expect(f.release).toHaveBeenCalledOnce()
	})
})
