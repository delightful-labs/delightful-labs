import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { createInternalTransferCreateMachine } from './internal-transfer-create.js'
import { createActor, waitFor } from 'xstate'

const organizationId = '11111111-1111-4111-8111-111111111111'
const identityId = '22222222-2222-4222-8222-222222222222'
const expenseAccountId = '33333333-3333-4333-8333-333333333333'
const incomeAccountId = '44444444-4444-4444-8444-444444444444'
const expenseTransactionId: ReturnType<typeof crypto.randomUUID> =
	'55555555-5555-4555-8555-555555555555'
const incomeTransactionId: ReturnType<typeof crypto.randomUUID> =
	'66666666-6666-4666-8666-666666666666'
const transferId: ReturnType<typeof crypto.randomUUID> = '77777777-7777-4777-8777-777777777777'
const actors: ReturnType<typeof createActor>[] = []

afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
	vi.restoreAllMocks()
})

function fixture(
	options: {
		incomeCurrency?: string
		expenseCurrency?: string
		submittedIncomeCurrency?: string
		submittedExpenseCurrency?: string
		expenseAmountMinor?: number
		incomeAmountMinor?: number
	} = {}
) {
	const tx = new Transaction('mergeable', () => {
		throw new Error('Fixture must not open a Jazz runtime')
	})
	const expenseAccount = {
		id: expenseAccountId,
		organizationId,
		name: 'Checking',
		kind: 'bank',
		currency: options.expenseCurrency ?? 'USD',
		archivedAt: null
	}
	const incomeAccount = {
		id: incomeAccountId,
		organizationId,
		name: 'Card',
		kind: 'card',
		currency: options.incomeCurrency ?? 'USD',
		archivedAt: null
	}
	const membership = {
		id: '88888888-8888-4888-8888-888888888888',
		organizationId,
		userId: identityId,
		profileId: null,
		role: 'owner',
		accountAccessMode: 'all'
	}
	const expenseCategory = {
		id: '99999999-9999-4999-8999-999999999999',
		organizationId,
		name: 'Expense',
		kind: 'expense',
		isSystem: true,
		archivedAt: null
	}
	const incomeCategory = {
		id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		organizationId,
		name: 'Income',
		kind: 'income',
		isSystem: true,
		archivedAt: null
	}
	const one = vi
		.spyOn(tx, 'one')
		.mockResolvedValueOnce(expenseAccount)
		.mockResolvedValueOnce(incomeAccount)
		.mockResolvedValueOnce(membership)
	const all = vi
		.spyOn(tx, 'all')
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([expenseCategory, incomeCategory])
	const inserted: { table: unknown; row: unknown; options: unknown }[] = []
	const insert = vi.spyOn(tx, 'insert').mockImplementation((table, row, options) => {
		inserted.push({ table, row, options })
		return { id: options?.id ?? '' } as never
	})
	const rollback = vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	const wait = vi.fn(async () => undefined)
	const commit = vi.fn(() => ({ txId: Promise.resolve('paired-create-transaction'), wait }))
	const beginTransaction = vi.fn(() => ({
		one: tx.one.bind(tx),
		all: tx.all.bind(tx),
		insert: tx.insert.bind(tx),
		commit,
		rollback: tx.rollback.bind(tx)
	}))
	const trackWrite = vi.fn()
	const ids = [expenseTransactionId, incomeTransactionId, transferId]
	vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
		const id = ids.shift()
		if (!id) throw new Error('Unexpected identifier allocation')
		return id
	})
	const actor = createActor(createInternalTransferCreateMachine(), {
		input: {
			db: { beginTransaction },
			identityId,
			organizationId,
			expenseAccountId,
			incomeAccountId,
			expenseAmountMinor: options.expenseAmountMinor ?? 100,
			incomeAmountMinor: options.incomeAmountMinor ?? 100,
			expenseCurrency: options.submittedExpenseCurrency ?? options.expenseCurrency ?? 'USD',
			incomeCurrency: options.submittedIncomeCurrency ?? options.incomeCurrency ?? 'USD',
			bookedOn: '2026-10-25',
			trackWrite
		}
	})
	actors.push(actor)
	return {
		actor: actor.start(),
		beginTransaction,
		one,
		all,
		inserted,
		rollback,
		wait,
		commit,
		trackWrite
	}
}

describe('internal transfer create machine', () => {
	it('creates both ordinary transactions and their transfer in one local transaction', async () => {
		const f = fixture()
		const done = await waitFor(f.actor, (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({
			outcome: 'succeeded',
			settlement: 'locallyPersisted',
			transferId,
			expenseTransactionId,
			incomeTransactionId
		})
		expect(f.beginTransaction).toHaveBeenCalledOnce()
		expect(f.one).toHaveBeenCalledTimes(3)
		expect(f.all).toHaveBeenCalledTimes(2)
		expect(f.inserted).toHaveLength(3)
		expect(f.inserted.map(({ table }) => table)).toEqual([
			app.transactions,
			app.transactions,
			app.internalTransfers
		])
		expect(f.inserted.map(({ row }) => row)).toEqual([
			expect.objectContaining({
				organizationId,
				accountId: expenseAccountId,
				categoryId: '99999999-9999-4999-8999-999999999999',
				kind: 'expense',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-25',
				internalTransferId: transferId
			}),
			expect.objectContaining({
				organizationId,
				accountId: incomeAccountId,
				categoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				kind: 'income',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-25',
				internalTransferId: transferId
			}),
			expect.objectContaining({
				organizationId,
				expenseTransactionId,
				incomeTransactionId,
				expenseAccountId,
				incomeAccountId,
				expenseAmountMinor: 100,
				expenseCurrency: 'USD',
				incomeAmountMinor: 100,
				incomeCurrency: 'USD'
			})
		])
		expect(f.commit).toHaveBeenCalledOnce()
		expect(f.trackWrite).toHaveBeenCalledWith({
			transactionId: 'paired-create-transaction',
			operation: 'create',
			transferId
		})
		expect(f.wait).toHaveBeenCalledOnce()
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('records separately entered amounts and currencies for different-currency accounts', async () => {
		const f = fixture({ incomeCurrency: 'TZS', expenseAmountMinor: 2500, incomeAmountMinor: 65000 })
		const done = await waitFor(f.actor, (snapshot) => snapshot.status === 'done')

		expect(done.output).toMatchObject({ outcome: 'succeeded' })
		expect(f.inserted.map(({ row }) => row)).toEqual([
			expect.objectContaining({ amountMinor: 2500, currency: 'USD' }),
			expect.objectContaining({ amountMinor: 65000, currency: 'TZS' }),
			expect.objectContaining({
				expenseAmountMinor: 2500,
				expenseCurrency: 'USD',
				incomeAmountMinor: 65000,
				incomeCurrency: 'TZS'
			})
		])
	})

	it('rejects inconsistent amounts when both selected accounts use one currency', async () => {
		const f = fixture({ expenseAmountMinor: 100, incomeAmountMinor: 101 })
		const done = await waitFor(f.actor, (snapshot) => snapshot.status === 'done')

		expect(done.output).toMatchObject({ outcome: 'incompatible', settlement: 'notStarted' })
		expect(f.inserted).toHaveLength(0)
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('rejects submitted currencies that do not match the selected accounts', async () => {
		const f = fixture({ incomeCurrency: 'TZS', submittedIncomeCurrency: 'USD' })
		const done = await waitFor(f.actor, (snapshot) => snapshot.status === 'done')

		expect(done.output).toMatchObject({ outcome: 'incompatible', settlement: 'notStarted' })
		expect(f.inserted).toHaveLength(0)
	})
})
