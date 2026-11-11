import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction, ReadTier, type schema } from 'jazz-tools'
import { transactionCheckpointSchema } from '#lib/contracts/transaction-save-contract.js'
import { app, type Check } from '#lib/schema.js'
import { createTransactionSaveMachine } from './transaction-save.js'
import type { TransactionEntryObservation } from '#lib/contracts/transaction-entry-contract.js'
import type { TransactionSaveValues } from '#lib/validation/transactions.js'
import { createActor, toPromise, createAsyncLogic } from 'xstate'

const organizationId = '22222222-2222-4222-8222-222222222222'
const accountId = '11111111-1111-4111-8111-111111111111'
const categoryId = '33333333-3333-4333-8333-333333333333'
const transactionId = '44444444-4444-4444-8444-444444444444'
const checkId = '55555555-5555-4555-8555-555555555555'
const binding = {}
const facts: TransactionEntryObservation = {
	identityId: 'user',
	organizationId,
	binding,
	kind: 'expense',
	sessionReady: true,
	loading: false,
	failed: false,
	membership: {
		id: 'member',
		userId: 'user',
		organizationId,
		role: 'owner',
		accountAccessMode: 'all',
		profileId: null
	},
	grants: [],
	accounts: [
		{
			id: accountId,
			organizationId,
			name: 'Wallet',
			kind: 'cash',
			currency: 'USD',
			archivedAt: null
		}
	],
	categories: [
		{
			id: categoryId,
			organizationId,
			name: 'Food',
			kind: 'expense',
			isSystem: false,
			archivedAt: null
		}
	],
	tags: []
}
const values: TransactionSaveValues = {
	organizationId,
	accountId,
	categoryId,
	kind: 'expense',
	source: { source: 'manual' },
	bookedOn: '2026-10-23',
	money: { amountMinor: 1234, currency: 'USD' },
	tags: [],
	paymentMethod: 'check',
	check: {
		kind: 'new',
		values: { checkNumber: '101', checkDate: '2026-10-23' }
	}
}
const cleanups: (() => void)[] = []
const persistedCheck: Check = {
	id: checkId,
	organizationId,
	accountId,
	checkNumber: '101',
	checkDate: '2026-10-23',
	payerName: null,
	bankName: null,
	memoOnCheck: null
}
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
})

const ledgerQuery = app.transactions.include({ tags: { tag: true }, check: true })
type LedgerSnapshot = schema.RowOf<typeof ledgerQuery>

function fixture() {
	vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(transactionId).mockReturnValue(checkId)
	const stage = vi.fn()
	const settle = vi.fn(async (_index: number) => {})
	const rollback = vi.fn(async () => true)
	let index = 0
	const inserts: { table: unknown; values: unknown; options?: unknown }[] = []
	const beginTransaction = vi.fn(() => {
		const writeIndex = index++
		const tx = new Transaction('mergeable', () => {
			throw new Error('Unit fixture must not open a runtime')
		})
		vi.spyOn(tx, 'insert').mockImplementation((table, row, options) => {
			stage(table, row, options)
			inserts.push({ table, values: row, options })
		})
		vi.spyOn(tx, 'all').mockResolvedValue([])
		vi.spyOn(tx, 'update').mockImplementation(() => {})
		vi.spyOn(tx, 'delete').mockImplementation(() => {})
		vi.spyOn(tx, 'rollback').mockImplementation(rollback)
		const wait = vi.fn((_options: { tier: 'local' | 'global' | 'edge' }) => settle(writeIndex))
		vi.spyOn(tx, 'commit').mockImplementation(vi.fn().mockReturnValue({ wait }))
		return tx
	})
	const read = vi.fn()
	const db = {
		beginTransaction,
		all: async <T>(query: unknown, options?: unknown): Promise<T[]> => {
			read(query, options)
			return []
		}
	}
	const observe = vi.fn(() => facts)
	const machine = createTransactionSaveMachine(db, observe)
	const actor = (
		saveValues = values,
		logic: import('xstate').ActorLogic<
			import('xstate').SnapshotFrom<typeof machine>,
			import('xstate').EventFromLogic<typeof machine>,
			import('xstate').InputFrom<typeof machine>,
			import('xstate').AnyActorSystem,
			import('xstate').EmittedFrom<typeof machine>
		> = machine,
		checkpoint?: unknown
	) => {
		const save = createActor(logic, {
			input: {
				request: {
					id: 1,
					scope: {
						identityId: 'user',
						organizationId,
						binding,
						kind: saveValues.kind
					},
					scopeRevision: 0,
					values: saveValues,
					...(checkpoint === undefined ? {} : { checkpoint })
				},
				observation: { revision: 0, facts }
			}
		}).start()
		cleanups.push(() => save.stop())
		return save
	}
	return { beginTransaction, machine, inserts, actor, stage, settle, rollback, observe, read }
}

describe('staged transaction save', () => {
	it('saves an inline Check before linking it to the ledger transaction', async () => {
		const f = fixture()
		const logic = f.machine.provide({
			actors: { readCheck: createAsyncLogic({ run: () => Promise.resolve([persistedCheck]) }) }
		})
		const result = await toPromise(f.actor(values, logic))
		expect(result).toMatchObject({
			outcome: 'succeeded',
			settlement: 'locallyPersisted',
			transactionId
		})
		expect(f.beginTransaction).toHaveBeenCalledTimes(2)
		expect(f.inserts[0]).toMatchObject({
			table: app.checks,
			values: { organizationId, accountId, checkNumber: '101', checkDate: '2026-10-23' }
		})
		expect(f.inserts.at(-1)).toMatchObject({
			table: app.transactions,
			values: { paymentMethod: 'check', checkId }
		})
	})

	it('writes a transaction without creating a Check when payment is unspecified', async () => {
		const f = fixture()
		const { check, ...withoutCheck } = values
		void check
		const result = await toPromise(f.actor({ ...withoutCheck, paymentMethod: null, checkId: null }))
		expect(result).toMatchObject({ outcome: 'succeeded' })
		expect(f.beginTransaction).toHaveBeenCalledOnce()
		expect(f.inserts).toContainEqual(
			expect.objectContaining({
				table: app.transactions,
				values: expect.objectContaining({ paymentMethod: null, checkId: null })
			})
		)
	})
})

describe('staged Check recovery and interruptions', () => {
	it('retains the allocated checkpoint when cancellation arrives during allocation', async () => {
		const f = fixture()
		const allocated =
			Promise.withResolvers<
				import('#lib/contracts/transaction-save-contract.js').TransactionCheckpoint
			>()
		const logic = f.machine.provide({
			actors: { allocate: createAsyncLogic({ run: () => allocated.promise }) }
		})
		const actor = f.actor(values, logic)
		await vi.waitFor(() =>
			expect(actor.getSnapshot().value).toMatchObject({ running: { flow: 'allocating' } })
		)
		actor.send({ type: 'CANCEL' })
		allocated.resolve({
			version: 1,
			scope: { identityId: 'user', organizationId, binding, kind: 'expense' },
			accountId,
			transactionId,
			checkId,
			checkIntent: 'new',
			checkSettlement: 'notStarted',
			transactionSettlement: 'notStarted'
		})
		await expect(toPromise(actor)).resolves.toMatchObject({
			outcome: 'cancelled',
			settlement: 'notStarted',
			checkpoint: { transactionId, checkId }
		})
	})

	it('retains a saved Check after ledger rejection and retries with the same IDs', async () => {
		const f = fixture()
		let rejectLedger = true
		f.stage.mockImplementation((table: unknown) => {
			if (table === app.transactions && rejectLedger) throw new Error('Ledger rejected')
		})
		const logic = f.machine.provide({
			actors: {
				readCheck: createAsyncLogic({ run: async (): Promise<Check[]> => [persistedCheck] })
			}
		})
		const first = await toPromise(f.actor(values, logic))
		expect(first).toMatchObject({ outcome: 'partial', reason: 'checkRetained' })
		const checkpoint = transactionCheckpointSchema.parse(first.checkpoint)
		expect(checkpoint).toMatchObject({ transactionId, checkId, transactionSettlement: 'rejected' })
		rejectLedger = false
		await expect(toPromise(f.actor(values, logic, checkpoint))).resolves.toMatchObject({
			outcome: 'succeeded'
		})
		expect(f.inserts.filter((entry) => entry.table === app.checks)).toHaveLength(1)
		expect(f.inserts.find((entry) => entry.table === app.transactions)).toMatchObject({
			options: { id: transactionId },
			values: { checkId }
		})
	})

	it('reconciles an uncertain Check before retrying without inserting another Check', async () => {
		const f = fixture()
		f.settle.mockRejectedValueOnce(new Error('Unknown Check settlement'))
		const reads: boolean[] = []
		const logic = f.machine.provide({
			actors: {
				readCheck: createAsyncLogic({
					run: async ({
						input
					}: {
						input: { id: string; uncertain: boolean }
					}): Promise<Check[]> => {
						reads.push(input.uncertain)
						return [persistedCheck]
					}
				})
			}
		})
		const first = await toPromise(f.actor(values, logic))
		expect(first).toMatchObject({
			outcome: 'partial',
			reason: 'saveUnresolved',
			settlement: 'unknown'
		})
		await expect(toPromise(f.actor(values, logic, first.checkpoint))).resolves.toMatchObject({
			outcome: 'succeeded'
		})
		expect(reads).toContain(true)
		expect(f.inserts.filter((entry) => entry.table === app.checks)).toHaveLength(1)
	})

	it.each(['matching', 'missing', 'conflicting'])(
		'reconciles uncertain ledger settlement without issuing another write (%s)',
		async (observed) => {
			const f = fixture()
			f.settle.mockImplementation(async (index) => {
				if (index === 1) throw new Error('Unknown ledger settlement')
			})
			const row: LedgerSnapshot = {
				id: transactionId,
				organizationId,
				accountId,
				categoryId,
				kind: 'expense',
				amountMinor: 1234,
				currency: 'USD',
				bookedOn: values.bookedOn,
				source: 'manual',
				externalId: null,
				description: null,
				memo: null,
				paymentMethod: 'check',
				checkId,
				checkDetailsId: null,
				internalTransferId: null,
				batchId: null,
				check: persistedCheck,
				tags: []
			}
			const readLedger = vi.fn(async (): Promise<LedgerSnapshot[]> =>
				observed === 'missing'
					? []
					: [{ ...row, amountMinor: observed === 'conflicting' ? 9999 : row.amountMinor }]
			)
			const logic = f.machine.provide({
				actors: {
					readCheck: createAsyncLogic({ run: async (): Promise<Check[]> => [persistedCheck] }),
					readLedger: createAsyncLogic({ run: readLedger })
				}
			})
			const first = await toPromise(f.actor(values, logic))
			expect(first).toMatchObject({ outcome: 'partial', reason: 'saveUnresolved' })
			const retried = await toPromise(f.actor(values, logic, first.checkpoint))
			expect(retried).toMatchObject(
				observed === 'matching'
					? { outcome: 'succeeded', settlement: 'confirmed' }
					: { outcome: 'partial', reason: 'saveUnresolved', settlement: 'unknown' }
			)
			expect(readLedger).toHaveBeenCalledOnce()
			expect(f.beginTransaction).toHaveBeenCalledTimes(2)
		}
	)

	it.each([
		{ index: 0, type: 'CANCEL', outcome: 'cancelled' },
		{ index: 0, type: 'INVALIDATE', outcome: 'scopeChanged' },
		{ index: 0, type: 'SHUTDOWN', outcome: 'closed' },
		{ index: 1, type: 'CANCEL', outcome: 'cancelled' },
		{ index: 1, type: 'INVALIDATE', outcome: 'scopeChanged' },
		{ index: 1, type: 'SHUTDOWN', outcome: 'closed' }
	] satisfies { index: number; type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN'; outcome: string }[])(
		'drains child $index after $type and retains its settlement',
		async ({ index, type, outcome }) => {
			const f = fixture()
			const pending = Promise.withResolvers<void>()
			f.settle.mockImplementation(async (current) => {
				if (current === index) await pending.promise
			})
			const logic = f.machine.provide({
				actors: {
					readCheck: createAsyncLogic({ run: async (): Promise<Check[]> => [persistedCheck] })
				}
			})
			const actor = f.actor(values, logic)
			await vi.waitFor(() => expect(f.settle).toHaveBeenCalledWith(index))
			actor.send({ type })
			expect(actor.getSnapshot().status).toBe('active')
			pending.resolve()
			const result = await toPromise(actor)
			expect(result).toMatchObject({ outcome })
			expect(transactionCheckpointSchema.parse(result.checkpoint)).toMatchObject({
				checkId,
				transactionId,
				checkSettlement: 'locallyPersisted',
				transactionSettlement: index === 0 ? 'notStarted' : 'locallyPersisted'
			})
			expect(f.beginTransaction).toHaveBeenCalledTimes(index + 1)
		}
	)
})

describe('staged Check scope and remote boundaries', () => {
	it.each([
		{ identityId: 'replacement' },
		{ organizationId: '66666666-6666-4666-8666-666666666666' },
		{ binding: {} }
	])(
		'rechecks scope after saving the Check and starts no ledger write after replacement: %j',
		async (replacement) => {
			const f = fixture()
			f.observe.mockReturnValueOnce(facts).mockReturnValue({ ...facts, ...replacement })
			const logic = f.machine.provide({
				actors: {
					readCheck: createAsyncLogic({ run: async (): Promise<Check[]> => [persistedCheck] })
				}
			})
			await expect(toPromise(f.actor(values, logic))).resolves.toMatchObject({
				outcome: 'partial',
				reason: 'checkRetained'
			})
			expect(f.beginTransaction).toHaveBeenCalledOnce()
			expect(f.inserts.every((entry) => entry.table === app.checks)).toBe(true)
		}
	)

	it.each([0, 1])(
		'uses a remote query to reconcile unknown child %s and never recreates an absent result',
		async (index) => {
			const f = fixture()
			f.settle.mockImplementation(async (current) => {
				if (current === index) throw new Error('Unknown durability')
			})
			const initial = f.machine.provide({
				actors: {
					readCheck: createAsyncLogic({ run: async (): Promise<Check[]> => [persistedCheck] })
				}
			})
			const first = await toPromise(f.actor(values, initial))
			const retry = await toPromise(f.actor(values, f.machine, first.checkpoint))
			expect(retry).toMatchObject({
				outcome: 'partial',
				reason: 'saveUnresolved',
				settlement: 'unknown'
			})
			expect(f.read).toHaveBeenCalledWith(expect.anything(), { tier: ReadTier.Remote })
			expect(f.beginTransaction).toHaveBeenCalledTimes(index + 1)
		}
	)
})
