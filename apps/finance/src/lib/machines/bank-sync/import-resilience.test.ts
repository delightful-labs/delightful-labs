import { describe, expect, it, vi } from 'vitest'
import { importFixture, raw, response } from './import.fixture.js'
import type { ProviderResponse } from './types.js'
import * as diagnostics from '#lib/integrations/diagnostics.js'
import { createCallbackLogic, toPromise } from 'xstate'

function singleAccountResponse(count: number): ProviderResponse {
	const provider = response.accounts[0]
	if (!provider) throw new Error('Missing provider')
	return {
		errors: [],
		accounts: [
			{
				...provider,
				transactions: Array.from({ length: count }, (_, index) => raw(`batch-${index}`))
			}
		]
	}
}

describe('bank import resilience', () => {
	it.each(['unavailable', 'duplicate'])(
		'reports %s account mappings without crashing',
		async (kind) => {
			const f = importFixture()
			if (kind === 'unavailable') f.loadAccount.mockResolvedValue([])
			else {
				const link = f.initialSource.links[0]
				if (!link) throw new Error('Missing fixture mapping')
				f.mappings.mockResolvedValue([
					...f.initialSource.links,
					{ ...link, id: crypto.randomUUID() }
				])
			}
			const { operation } = f.start()
			await expect(toPromise(operation)).resolves.toMatchObject({
				kind: 'failed',
				error: new Error('mapping'),
				counts: { imported: 0, existing: 0 },
				settlement: 'settled'
			})
			expect(f.persist).not.toHaveBeenCalled()
			expect(f.release).toHaveBeenCalledOnce()
		}
	)
	it('uses only positive cached IDs; misses retain the original lookup and write checks', async () => {
		const f = importFixture()
		await expect(toPromise(f.startTransaction())).resolves.toEqual({ kind: 'imported' })
		const known = new Set(f.stored.keys())
		f.membership.mockClear()
		f.lookup.mockClear()
		await expect(toPromise(f.startTransaction(undefined, known))).resolves.toEqual({
			kind: 'existing'
		})
		expect(f.membership).not.toHaveBeenCalled()
		expect(f.lookup).not.toHaveBeenCalled()
		await expect(toPromise(f.startTransaction(undefined, new Set()))).resolves.toEqual({
			kind: 'existing'
		})
		expect(f.membership).toHaveBeenCalledOnce()
		expect(f.lookup).toHaveBeenCalledOnce()
		expect(f.persist).toHaveBeenCalledOnce()
	})
	it('retains user edits on a cached row and imports only a new provider identity', async () => {
		const f = importFixture()
		await toPromise(f.start().operation)
		const row = [...f.stored.values()][0]
		if (!row) throw new Error('Missing imported row')
		const edited = { ...row, amountMinor: 9876, description: 'User edit', memo: 'Keep this' }
		f.stored.set(row.id, edited)
		const provider = response.accounts[0]
		if (!provider) throw new Error('Missing provider')
		f.fetch.mockResolvedValue({
			...response,
			accounts: [{ ...provider, transactions: [raw('first'), raw('new')] }]
		})
		f.lookup.mockClear()
		await expect(toPromise(f.start().operation)).resolves.toMatchObject({
			kind: 'complete',
			counts: { imported: 1, existing: 1 }
		})
		expect(f.stored.get(row.id)).toEqual(edited)
		expect(f.lookup).toHaveBeenCalledOnce()
	})
	it('falls back to individual lookups when the snapshot is partial or fails', async () => {
		const f = importFixture()
		await toPromise(f.start().operation)
		f.existingIds.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('snapshot unavailable'))
		f.lookup.mockClear()
		await expect(toPromise(f.start().operation)).resolves.toMatchObject({
			kind: 'complete',
			counts: { imported: 0, existing: 3 }
		})
		expect(f.lookup).toHaveBeenCalledTimes(3)
		expect(f.persist).toHaveBeenCalledTimes(3)
	})
	it('bounds a stalled optional snapshot and ignores its late result', async () => {
		const f = importFixture({ existingReadDeadline: 5 })
		const pending = Promise.withResolvers<{ id: string }[]>()
		f.existingIds.mockReturnValueOnce(pending.promise)
		await expect(toPromise(f.start().operation)).resolves.toMatchObject({
			kind: 'complete',
			counts: { imported: 3 }
		})
		pending.resolve([{ id: crypto.randomUUID() }])
		await pending.promise
		expect(f.persist).toHaveBeenCalledTimes(3)
		expect(f.fetch).toHaveBeenCalledOnce()
	})
	it('does not duplicate a transaction repeated in the same response after an empty snapshot', async () => {
		const f = importFixture()
		const provider = response.accounts[0]
		if (!provider) throw new Error('Missing provider')
		f.fetch.mockResolvedValue({
			...response,
			accounts: [{ ...provider, transactions: [raw('first'), raw('first')] }]
		})
		await expect(toPromise(f.start().operation)).resolves.toMatchObject({
			kind: 'complete',
			counts: { imported: 1, existing: 1 }
		})
		expect(f.stored.size).toBe(1)
		expect(f.persist).toHaveBeenCalledOnce()
	})
	it.each(['authorization', 'lookup', 'writeAuthorization'])(
		'bounds a stalled %s and ignores its late result without writing',
		async (stage) => {
			const f = importFixture({ readDeadline: 5 })
			const gate = Promise.withResolvers<void>()
			if (stage === 'writeAuthorization') {
				const allowed = await f.membership()
				f.membership.mockClear()
				f.membership.mockResolvedValueOnce(allowed).mockImplementationOnce(async () => {
					await gate.promise
					return []
				})
			} else if (stage === 'authorization')
				f.membership.mockImplementationOnce(async () => {
					await gate.promise
					return []
				})
			else
				f.lookup.mockImplementationOnce(async () => {
					await gate.promise
					return []
				})
			const actor = f.startTransaction()
			await expect(toPromise(actor)).resolves.toMatchObject({
				kind: 'failed',
				error: new Error('import-read-timeout')
			})
			gate.resolve()
			await gate.promise
			expect(f.persist).not.toHaveBeenCalled()
		}
	)
	it('cancels a pending optional snapshot without starting any financial writes', async () => {
		const f = importFixture()
		const pending = Promise.withResolvers<{ id: string }[]>()
		f.existingIds.mockReturnValueOnce(pending.promise)
		const { bank, operation } = f.start()
		await vi.waitFor(() => expect(f.existingIds).toHaveBeenCalledOnce())
		bank.send({ type: 'CANCEL' })
		await expect(toPromise(operation)).resolves.toMatchObject({
			kind: 'cancelled',
			counts: { imported: 0 },
			settlement: 'settled'
		})
		pending.resolve([])
		await pending.promise
		expect(f.persist).not.toHaveBeenCalled()
		expect(f.fetch).toHaveBeenCalledOnce()
		expect(f.release).toHaveBeenCalledOnce()
	})
	it('cancels during the traversal yield and never starts the next transaction', async () => {
		const entered = Promise.withResolvers<void>()
		const f = importFixture({
			yieldControl: createCallbackLogic<{ type: 'CONTINUE' }>(() => {
				entered.resolve()
			})
		})
		f.fetch.mockResolvedValue(singleAccountResponse(26))
		const { operation, bank } = f.start()
		await entered.promise
		expect(f.persist).toHaveBeenCalledTimes(25)
		bank.send({ type: 'CANCEL' })
		await expect(toPromise(operation)).resolves.toMatchObject({
			kind: 'cancelled',
			counts: { imported: 25 }
		})
		expect(f.persist).toHaveBeenCalledTimes(25)
		expect(f.release).toHaveBeenCalledOnce()
	})
	it.each([
		{ count: 0, yields: 0 },
		{ count: 1, yields: 0 },
		{ count: 25, yields: 0 },
		{ count: 26, yields: 1 },
		{ count: 50, yields: 1 },
		{ count: 51, yields: 2 }
	])(
		'yields between batches for $count rows ($yields yields), without a final yield',
		async ({ count, yields }) => {
			const Channel = globalThis.MessageChannel
			const channels = vi.fn(function () {
				return new Channel()
			})
			vi.stubGlobal('MessageChannel', channels)
			try {
				const f = importFixture()
				f.fetch.mockResolvedValue(singleAccountResponse(count))
				await expect(toPromise(f.start().operation)).resolves.toMatchObject({
					kind: 'complete',
					counts: { imported: count }
				})
				expect(channels).toHaveBeenCalledTimes(yields)
			} finally {
				vi.unstubAllGlobals()
			}
		}
	)
	it.each(['empty', 'missing'])(
		'skips duplicate snapshots for %s transaction lists and retains balances',
		async (kind) => {
			const f = importFixture()
			const provider = response.accounts[0]
			if (!provider) throw new Error('Missing provider')
			const { transactions, ...withoutTransactions } = provider
			f.fetch.mockResolvedValue({
				errors: [],
				accounts: [kind === 'empty' ? { ...provider, transactions: [] } : withoutTransactions]
			})
			await expect(toPromise(f.start().operation)).resolves.toMatchObject({
				kind: 'complete',
				counts: { imported: 0, existing: 0 }
			})
			expect(f.existingIds).not.toHaveBeenCalled()
			expect(f.saveBalanceSnapshot).toHaveBeenCalledOnce()
			expect(f.persist).not.toHaveBeenCalled()
		}
	)
	it.each(['timeout', 'cancel'])(
		'owns snapshot logs through %s without heartbeat or late completion logs',
		async (mode) => {
			const log = vi.fn<diagnostics.BankTrace['log']>()
			const stepped = vi.fn()
			const trace: diagnostics.BankTrace = {
				id: 'snapshot-test',
				log,
				failed: vi.fn(),
				step: async (_stage, effect) => {
					stepped()
					return effect()
				}
			}
			vi.spyOn(diagnostics, 'createBankTrace').mockReturnValue(trace)
			const f = importFixture({ existingReadDeadline: 5 })
			const pending = Promise.withResolvers<{ id: string }[]>()
			const entered = Promise.withResolvers<void>()
			f.existingIds.mockImplementationOnce(() => {
				entered.resolve()
				return pending.promise
			})
			const { operation, bank } = f.start()
			await entered.promise
			if (mode === 'cancel') bank.send({ type: 'CANCEL' })
			await toPromise(operation)
			const snapshotLogs = log.mock.calls.filter(([stage]) =>
				stage.startsWith('import.existing-snapshot')
			)
			expect(snapshotLogs).toContainEqual(['import.existing-snapshot:start'])
			if (mode === 'timeout')
				expect(snapshotLogs).toContainEqual(['import.existing-snapshot.timeout'])
			pending.resolve([])
			await pending.promise
			await Promise.resolve()
			expect(
				log.mock.calls.filter(([stage]) => stage.startsWith('import.existing-snapshot'))
			).toEqual(snapshotLogs)
			expect(stepped).not.toHaveBeenCalled()
		}
	)
	it('removes per-row database round trips from an explicit 225-row repeat sync', async () => {
		const f = importFixture()
		const provider = response.accounts[0]
		if (!provider) throw new Error('Missing provider')
		const large: ProviderResponse = {
			errors: [],
			accounts: [
				{ ...provider, transactions: Array.from({ length: 225 }, (_, i) => raw(`row-${i}`)) }
			]
		}
		f.fetch.mockResolvedValue(large)
		const initial = performance.now()
		await expect(toPromise(f.start().operation)).resolves.toMatchObject({
			kind: 'complete',
			counts: { imported: 225 }
		})
		const initialMs = performance.now() - initial
		expect(f.lookup).toHaveBeenCalledTimes(225)
		f.lookup.mockClear()
		f.membership.mockClear()
		const repeat = performance.now()
		await expect(toPromise(f.start().operation)).resolves.toMatchObject({
			kind: 'complete',
			counts: { imported: 0, existing: 225 }
		})
		const repeatMs = performance.now() - repeat
		expect(f.lookup).not.toHaveBeenCalled()
		expect(f.membership.mock.calls.length).toBeLessThan(10)
		expect(f.persist).toHaveBeenCalledTimes(225)
		console.info('225-row synthetic import measurement', {
			initialMs: Math.round(initialMs),
			repeatMs: Math.round(repeatMs),
			repeatLookups: f.lookup.mock.calls.length,
			repeatAuthorizationQueries: f.membership.mock.calls.length
		})
	})
})
