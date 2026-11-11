import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import {
	app,
	type InternalTransfer,
	type OrganizationMember,
	type TransactionRow
} from '#lib/schema.js'
import {
	internalTransferDeleteMachine,
	internalTransferLinkMachine,
	internalTransferUnlinkMachine,
	type InternalTransferDeleteInput,
	type InternalTransferDeleteChoice,
	type InternalTransferUnlinkInput,
	type TransferWriteTracking
} from './internal-transfer.js'
import { createActor, waitFor } from 'xstate'

const organizationId = '11111111-1111-4111-8111-111111111111'
const identityId = '22222222-2222-4222-8222-222222222222'
const expenseId = '33333333-3333-4333-8333-333333333333'
const incomeId = '44444444-4444-4444-8444-444444444444'
const expenseAccountId = '55555555-5555-4555-8555-555555555555'
const incomeAccountId = '66666666-6666-4666-8666-666666666666'
const transferId = '77777777-7777-4777-8777-777777777777'

function transaction(
	id: string,
	kind: 'expense' | 'income',
	accountId: string,
	overrides: Partial<TransactionRow> = {}
): TransactionRow {
	return {
		id,
		organizationId,
		accountId,
		categoryId: '88888888-8888-4888-8888-888888888888',
		kind,
		amountMinor: 4500,
		currency: 'USD',
		bookedOn: '2026-10-23',
		description: null,
		memo: null,
		paymentMethod: null,
		checkId: null,
		checkDetailsId: null,
		internalTransferId: null,
		source: 'manual',
		externalId: null,
		batchId: null,
		...overrides
	}
}

const expense = transaction(expenseId, 'expense', expenseAccountId)
const income = transaction(incomeId, 'income', incomeAccountId)
const membership: OrganizationMember = {
	id: '99999999-9999-4999-8999-999999999999',
	organizationId,
	userId: identityId,
	profileId: null,
	role: 'owner',
	accountAccessMode: 'all'
}

const actors: ReturnType<typeof createActor>[] = []
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
	vi.restoreAllMocks()
})

function fixture(
	options: { expense?: TransactionRow | null; income?: TransactionRow | null } = {}
) {
	const tx = new Transaction('mergeable', () => {
		throw new Error('Fixture must not open a Jazz runtime')
	})
	const one = vi
		.spyOn(tx, 'one')
		.mockResolvedValueOnce(options.expense === undefined ? expense : options.expense)
		.mockResolvedValueOnce(options.income === undefined ? income : options.income)
		.mockResolvedValueOnce(membership)
	const transfer: InternalTransfer = {
		id: transferId,
		organizationId,
		expenseTransactionId: expenseId,
		incomeTransactionId: incomeId,
		expenseAccountId,
		incomeAccountId,
		expenseAmountMinor: null,
		expenseCurrency: null,
		incomeAmountMinor: null,
		incomeCurrency: null,
		amountMinor: 4500,
		currency: 'USD'
	}
	const all = vi.spyOn(tx, 'all').mockResolvedValueOnce([])
	for (let index = 0; index < 4; index += 1) all.mockResolvedValueOnce([])
	const insert = vi.spyOn(tx, 'insert').mockReturnValue(transfer)
	const update = vi.spyOn(tx, 'update').mockImplementation(vi.fn())
	const remove = vi.spyOn(tx, 'delete').mockImplementation(vi.fn())
	vi.spyOn(crypto, 'randomUUID').mockReturnValue(transferId)
	const rollback = vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	const writeOrder: string[] = []
	const wait = vi.fn(async () => {
		writeOrder.push('local')
	})
	const commit = vi.fn(() => ({ txId: Promise.resolve('link-transaction'), wait }))
	const unlinkWait = vi.fn(async () => {
		writeOrder.push('local')
	})
	let unlinkTransactionSequence = 0
	const unlinkWrite = () => {
		unlinkTransactionSequence += 1
		return {
			txId: Promise.resolve(`unlink-transaction-${unlinkTransactionSequence}`),
			wait: unlinkWait
		}
	}
	const unlinkOne = vi.fn()
	const unlinkAll = vi.fn()
	const unlinkTransaction = vi.fn<InternalTransferUnlinkInput['db']['transaction']>(
		async (callback) => {
			callback({ update })
			return unlinkWrite()
		}
	)
	const deleteTransaction = vi.fn<InternalTransferDeleteInput['db']['transaction']>(
		async (callback) => {
			callback({ update, delete: remove })
			return unlinkWrite()
		}
	)
	const unlinkDelete = vi.fn((table: typeof app.internalTransfers, id: string) => {
		remove(table, id)
		return unlinkWrite()
	})
	const unlinkDb = {
		one: unlinkOne,
		all: unlinkAll,
		transaction: unlinkTransaction,
		delete: unlinkDelete
	}
	const deleteDb = {
		one: unlinkOne,
		all: unlinkAll,
		transaction: deleteTransaction
	}
	const beginTransaction = vi.fn(() => ({
		one: tx.one.bind(tx),
		all: tx.all.bind(tx),
		insert: tx.insert.bind(tx),
		update: tx.update.bind(tx),
		delete: tx.delete.bind(tx),
		commit,
		rollback: tx.rollback.bind(tx)
	}))
	const db = { beginTransaction }
	const trackWrite = vi.fn((_write: TransferWriteTracking) => {
		writeOrder.push('tracked')
	})
	const actor = () => {
		const instance = createActor(internalTransferLinkMachine, {
			input: {
				db,
				identityId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				trackWrite
			}
		})
		actors.push(instance)
		return instance.start()
	}
	const unlinkActor = (request: Partial<{ transferId: string; organizationId: string }> = {}) => {
		const instance = createActor(internalTransferUnlinkMachine, {
			input: {
				db: unlinkDb,
				identityId,
				organizationId,
				transferId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				trackWrite,
				...request
			}
		})
		actors.push(instance)
		return instance.start()
	}
	const deleteActor = (
		choice: InternalTransferDeleteChoice,
		request: Partial<{ transferId: string; organizationId: string }> = {}
	) => {
		const instance = createActor(internalTransferDeleteMachine, {
			input: {
				db: deleteDb,
				identityId,
				organizationId,
				transferId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				trackWrite,
				choice,
				...request
			}
		})
		actors.push(instance)
		return instance.start()
	}
	return {
		tx,
		one,
		all,
		insert,
		update,
		remove,
		rollback,
		wait,
		commit,
		unlinkWait,
		trackWrite,
		writeOrder,
		unlinkOne,
		unlinkAll,
		unlinkTransaction,
		deleteTransaction,
		unlinkDelete,
		beginTransaction,
		actor,
		unlinkActor,
		deleteActor
	}
}

describe('internal transfer link machine', () => {
	it('links compatible existing rows atomically and waits only for local persistence', async () => {
		const f = fixture()
		const actor = f.actor()
		const done = await waitFor(actor, (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({
			outcome: 'succeeded',
			transferId,
			settlement: 'locallyPersisted'
		})
		expect(f.beginTransaction).toHaveBeenCalledOnce()
		expect(f.one).toHaveBeenCalledTimes(3)
		expect(f.all).toHaveBeenCalledTimes(5)
		expect(f.insert).toHaveBeenCalledWith(
			app.internalTransfers,
			expect.objectContaining({
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				expenseAccountId,
				incomeAccountId,
				expenseAmountMinor: 4500,
				expenseCurrency: 'USD',
				incomeAmountMinor: 4500,
				incomeCurrency: 'USD'
			}),
			{ id: transferId }
		)
		expect(f.update).toHaveBeenCalledWith(app.transactions, expenseId, {
			internalTransferId: transferId
		})
		expect(f.update).toHaveBeenCalledWith(app.transactions, incomeId, {
			internalTransferId: transferId
		})
		expect(f.commit).toHaveBeenCalledOnce()
		expect(f.wait).toHaveBeenCalledOnce()
		expect(f.trackWrite).toHaveBeenCalledWith({
			transactionId: 'link-transaction',
			operation: 'link',
			transferId
		})
		expect(f.writeOrder).toEqual(['tracked', 'local'])
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('does not stage a relationship for a mismatched amount', async () => {
		const f = fixture({
			income: transaction(incomeId, 'income', incomeAccountId, { amountMinor: 4501 })
		})
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'incompatible', settlement: 'notStarted' })
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('does not stage a relationship when the requested workspace does not match', async () => {
		const f = fixture({
			expense: transaction(expenseId, 'expense', expenseAccountId, { organizationId: 'other' })
		})
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'incompatible', settlement: 'notStarted' })
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('rolls back when either endpoint is already linked', async () => {
		const f = fixture()
		f.all.mockReset().mockResolvedValueOnce([])
		f.all.mockResolvedValueOnce([
			{
				id: transferId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				expenseAccountId,
				incomeAccountId,
				expenseAmountMinor: null,
				expenseCurrency: null,
				incomeAmountMinor: null,
				incomeCurrency: null,
				amountMinor: 4500,
				currency: 'USD'
			} satisfies InternalTransfer
		])
		f.all.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'alreadyLinked', settlement: 'notStarted' })
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('reports denied when account authorization fails before staging writes', async () => {
		const f = fixture()
		f.one
			.mockReset()
			.mockResolvedValueOnce(expense)
			.mockResolvedValueOnce(income)
			.mockResolvedValueOnce({ ...membership, role: 'viewer' })
		f.all.mockReset().mockResolvedValueOnce([])
		for (let index = 0; index < 4; index += 1) f.all.mockResolvedValueOnce([])
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toMatchObject({
			outcome: 'denied',
			settlement: 'notStarted'
		})
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('reports unresolved local settlement failures without attempting rollback after commit', async () => {
		const f = fixture()
		const error = new Error('local persistence unavailable')
		f.wait.mockRejectedValue(error)
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({
			outcome: 'unavailable',
			settlement: 'unresolved',
			phase: 'localSettlement',
			error
		})
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('rolls back after cancellation while reading and reports cancellation only after cleanup', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<TransactionRow | null>()
		f.one
			.mockReset()
			.mockReturnValueOnce(pending.promise)
			.mockResolvedValueOnce(income)
			.mockResolvedValueOnce(membership)
		const actor = f.actor()
		await vi.waitFor(() =>
			expect(actor.getSnapshot().matches({ running: { work: 'reading' } })).toBe(true)
		)
		actor.send({ type: 'CANCEL' })
		expect(f.rollback).not.toHaveBeenCalled()
		pending.resolve(expense)
		const done = await waitFor(actor, (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.insert).not.toHaveBeenCalled()
	})
})

describe('internal transfer unlink machine', () => {
	function linkedFixture() {
		const f = fixture()
		f.unlinkOne
			.mockReset()
			.mockResolvedValueOnce({
				id: transferId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				expenseAccountId,
				incomeAccountId,
				expenseAmountMinor: null,
				expenseCurrency: null,
				incomeAmountMinor: null,
				incomeCurrency: null,
				amountMinor: 4500,
				currency: 'USD'
			} satisfies InternalTransfer)
			.mockResolvedValueOnce({ ...expense, internalTransferId: transferId })
			.mockResolvedValueOnce({ ...income, internalTransferId: transferId })
			.mockResolvedValueOnce(membership)
		f.unlinkAll.mockReset().mockResolvedValueOnce([])
		return f
	}

	it('clears both endpoint markers and removes the relationship in ordered local writes', async () => {
		const f = linkedFixture()
		const done = await waitFor(f.unlinkActor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({
			outcome: 'succeeded',
			transferId,
			settlement: 'locallyPersisted'
		})
		expect(f.update).toHaveBeenCalledWith(app.transactions, expenseId, { internalTransferId: null })
		expect(f.update).toHaveBeenCalledWith(app.transactions, incomeId, { internalTransferId: null })
		expect(f.remove).toHaveBeenCalledWith(app.internalTransfers, transferId)
		expect(f.unlinkTransaction).toHaveBeenCalledOnce()
		expect(f.unlinkDelete).toHaveBeenCalledOnce()
		expect(f.unlinkWait).toHaveBeenCalledTimes(2)
		expect(f.unlinkWait).toHaveBeenCalledWith({ tier: 'local' })
		expect(f.trackWrite).toHaveBeenNthCalledWith(1, {
			transactionId: 'unlink-transaction-1',
			operation: 'unlink',
			transferId
		})
		expect(f.trackWrite).toHaveBeenNthCalledWith(2, {
			transactionId: 'unlink-transaction-2',
			operation: 'unlink',
			transferId
		})
		expect(f.writeOrder).toEqual(['tracked', 'local', 'tracked', 'local'])
	})

	it('unlinks legacy transfers when Jazz defaults absent side amounts to zero', async () => {
		const f = linkedFixture()
		f.unlinkOne
			.mockReset()
			.mockResolvedValueOnce({
				id: transferId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				expenseAccountId,
				incomeAccountId,
				expenseAmountMinor: 0,
				expenseCurrency: null,
				incomeAmountMinor: 0,
				incomeCurrency: null,
				amountMinor: 4500,
				currency: 'USD'
			} satisfies InternalTransfer)
			.mockResolvedValueOnce({ ...expense, internalTransferId: transferId })
			.mockResolvedValueOnce({ ...income, internalTransferId: transferId })
			.mockResolvedValueOnce(membership)
		f.unlinkAll.mockReset().mockResolvedValueOnce([])
		const done = await waitFor(f.unlinkActor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toMatchObject({ outcome: 'succeeded', transferId })
	})

	it('unlinks cross-currency endpoint facts using each side amount and currency', async () => {
		const f = linkedFixture()
		f.unlinkOne
			.mockReset()
			.mockResolvedValueOnce({
				id: transferId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				expenseAccountId,
				incomeAccountId,
				expenseAmountMinor: 4217,
				expenseCurrency: 'USD',
				incomeAmountMinor: 6500000,
				incomeCurrency: 'TZS',
				amountMinor: null,
				currency: null
			} satisfies InternalTransfer)
			.mockResolvedValueOnce({
				...expense,
				amountMinor: 4217,
				currency: 'USD',
				internalTransferId: transferId
			})
			.mockResolvedValueOnce({
				...income,
				amountMinor: 6500000,
				currency: 'TZS',
				internalTransferId: transferId
			})
			.mockResolvedValueOnce(membership)
		f.unlinkAll.mockReset().mockResolvedValueOnce([])
		const done = await waitFor(f.unlinkActor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({
			outcome: 'succeeded',
			transferId,
			settlement: 'locallyPersisted'
		})
	})

	it('does not stage writes when the user cannot edit both accounts', async () => {
		const f = linkedFixture()
		f.unlinkOne.mockReset().mockResolvedValueOnce({
			id: transferId,
			organizationId,
			expenseTransactionId: expenseId,
			incomeTransactionId: incomeId,
			expenseAccountId,
			incomeAccountId,
			expenseAmountMinor: null,
			expenseCurrency: null,
			incomeAmountMinor: null,
			incomeCurrency: null,
			amountMinor: 4500,
			currency: 'USD'
		} satisfies InternalTransfer)
		f.unlinkOne
			.mockResolvedValueOnce({ ...expense, internalTransferId: transferId })
			.mockResolvedValueOnce({ ...income, internalTransferId: transferId })
			.mockResolvedValueOnce({ ...membership, role: 'viewer' })
		f.unlinkAll.mockReset().mockResolvedValueOnce([])
		const done = await waitFor(f.unlinkActor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'denied', settlement: 'notStarted' })
		expect(f.update).not.toHaveBeenCalled()
		expect(f.remove).not.toHaveBeenCalled()
		expect(f.unlinkTransaction).not.toHaveBeenCalled()
	})

	it('rejects a relationship whose endpoint facts no longer match', async () => {
		const f = linkedFixture()
		f.unlinkOne.mockReset().mockResolvedValueOnce({
			id: transferId,
			organizationId,
			expenseTransactionId: expenseId,
			incomeTransactionId: incomeId,
			expenseAccountId,
			incomeAccountId,
			expenseAmountMinor: null,
			expenseCurrency: null,
			incomeAmountMinor: null,
			incomeCurrency: null,
			amountMinor: 4500,
			currency: 'USD'
		} satisfies InternalTransfer)
		f.unlinkOne.mockResolvedValueOnce({ ...expense, internalTransferId: transferId })
		f.unlinkOne.mockResolvedValueOnce({
			...income,
			internalTransferId: transferId,
			amountMinor: 4501
		})
		f.unlinkOne.mockResolvedValueOnce(membership)
		f.unlinkAll.mockReset().mockResolvedValueOnce([])
		const done = await waitFor(f.unlinkActor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'incompatible', settlement: 'notStarted' })
		expect(f.update).not.toHaveBeenCalled()
		expect(f.remove).not.toHaveBeenCalled()
		expect(f.unlinkTransaction).not.toHaveBeenCalled()
	})
})

describe('internal transfer delete machine', () => {
	function linkedFixture(
		options: {
			membership?: OrganizationMember
			grants?: { accountId: string; access: 'read' | 'write'; canDelete: boolean }[]
			markers?: 'linked' | 'pending'
		} = {}
	) {
		const f = fixture()
		const marker = options.markers === 'pending' ? null : transferId
		f.unlinkOne
			.mockReset()
			.mockResolvedValueOnce({
				id: transferId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				expenseAccountId,
				incomeAccountId,
				expenseAmountMinor: null,
				expenseCurrency: null,
				incomeAmountMinor: null,
				incomeCurrency: null,
				amountMinor: 4500,
				currency: 'USD'
			} satisfies InternalTransfer)
			.mockResolvedValueOnce({ ...expense, internalTransferId: marker })
			.mockResolvedValueOnce({ ...income, internalTransferId: marker })
			.mockResolvedValueOnce(options.membership ?? membership)
		f.unlinkAll.mockReset().mockResolvedValueOnce(
			options.grants ?? [
				{ accountId: expenseAccountId, access: 'write', canDelete: true },
				{ accountId: incomeAccountId, access: 'write', canDelete: true }
			]
		)
		return f
	}

	it('clears markers, then atomically deletes the relationship and both endpoints', async () => {
		const f = linkedFixture()
		const done = await waitFor(
			f.deleteActor({ kind: 'both' }),
			(snapshot) => snapshot.status === 'done'
		)

		expect(done.output).toEqual({
			outcome: 'succeeded',
			transferId,
			choice: { kind: 'both' },
			deletedTransactionIds: [expenseId, incomeId],
			settlement: 'locallyPersisted'
		})
		expect(f.deleteTransaction).toHaveBeenCalledTimes(2)
		expect(f.update).toHaveBeenCalledWith(app.transactions, expenseId, { internalTransferId: null })
		expect(f.update).toHaveBeenCalledWith(app.transactions, incomeId, { internalTransferId: null })
		expect(f.remove).toHaveBeenCalledWith(app.internalTransfers, transferId)
		expect(f.remove).toHaveBeenCalledWith(app.transactions, expenseId)
		expect(f.remove).toHaveBeenCalledWith(app.transactions, incomeId)
		expect(f.trackWrite).toHaveBeenNthCalledWith(1, {
			transactionId: 'unlink-transaction-1',
			operation: 'delete',
			transferId
		})
		expect(f.trackWrite).toHaveBeenNthCalledWith(2, {
			transactionId: 'unlink-transaction-2',
			operation: 'delete',
			transferId
		})
		expect(f.writeOrder).toEqual(['tracked', 'local', 'tracked', 'local'])
	})

	it('deletes only the selected endpoint and retains the now-unlinked counterpart', async () => {
		const f = linkedFixture()
		const choice = { kind: 'selected', transactionId: expenseId } as const
		const done = await waitFor(f.deleteActor(choice), (snapshot) => snapshot.status === 'done')

		expect(done.output).toMatchObject({
			outcome: 'succeeded',
			choice,
			deletedTransactionIds: [expenseId],
			settlement: 'locallyPersisted'
		})
		expect(f.remove).toHaveBeenCalledWith(app.internalTransfers, transferId)
		expect(f.remove).toHaveBeenCalledWith(app.transactions, expenseId)
		expect(f.remove).not.toHaveBeenCalledWith(app.transactions, incomeId)
	})

	it('retries a pending unlink by deleting records without clearing markers again', async () => {
		const f = linkedFixture({ markers: 'pending' })
		const done = await waitFor(
			f.deleteActor({ kind: 'both' }),
			(snapshot) => snapshot.status === 'done'
		)

		expect(done.output).toMatchObject({ outcome: 'succeeded', settlement: 'locallyPersisted' })
		expect(f.deleteTransaction).toHaveBeenCalledOnce()
		expect(f.update).not.toHaveBeenCalled()
	})

	it('requires delete authority independently for every selected endpoint', async () => {
		const f = linkedFixture({
			membership: { ...membership, role: 'member', accountAccessMode: 'selected' },
			grants: [
				{ accountId: expenseAccountId, access: 'write', canDelete: true },
				{ accountId: incomeAccountId, access: 'write', canDelete: false }
			]
		})
		const done = await waitFor(
			f.deleteActor({ kind: 'both' }),
			(snapshot) => snapshot.status === 'done'
		)

		expect(done.output).toEqual({ outcome: 'denied', settlement: 'notStarted' })
		expect(f.deleteTransaction).not.toHaveBeenCalled()
		expect(f.remove).not.toHaveBeenCalled()
	})

	it('permits selected-side deletion with only that endpoint grant', async () => {
		const f = linkedFixture({
			membership: { ...membership, role: 'member', accountAccessMode: 'selected' },
			grants: [
				{ accountId: expenseAccountId, access: 'write', canDelete: true },
				{ accountId: incomeAccountId, access: 'write', canDelete: false }
			]
		})
		const done = await waitFor(
			f.deleteActor({ kind: 'selected', transactionId: expenseId }),
			(snapshot) => snapshot.status === 'done'
		)

		expect(done.output).toMatchObject({
			outcome: 'succeeded',
			deletedTransactionIds: [expenseId]
		})
	})

	it('deletes a cross-currency transfer after validating each endpoint independently', async () => {
		const f = linkedFixture()
		f.unlinkOne
			.mockReset()
			.mockResolvedValueOnce({
				id: transferId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				expenseAccountId,
				incomeAccountId,
				expenseAmountMinor: 4217,
				expenseCurrency: 'USD',
				incomeAmountMinor: 6500000,
				incomeCurrency: 'TZS',
				amountMinor: null,
				currency: null
			} satisfies InternalTransfer)
			.mockResolvedValueOnce({
				...expense,
				amountMinor: 4217,
				currency: 'USD',
				internalTransferId: transferId
			})
			.mockResolvedValueOnce({
				...income,
				amountMinor: 6500000,
				currency: 'TZS',
				internalTransferId: transferId
			})
			.mockResolvedValueOnce(membership)
		f.unlinkAll.mockReset().mockResolvedValueOnce([
			{ accountId: expenseAccountId, access: 'write', canDelete: true },
			{ accountId: incomeAccountId, access: 'write', canDelete: true }
		])
		const done = await waitFor(
			f.deleteActor({ kind: 'both' }),
			(snapshot) => snapshot.status === 'done'
		)

		expect(done.output).toMatchObject({
			outcome: 'succeeded',
			deletedTransactionIds: [expenseId, incomeId]
		})
	})

	it('deletes legacy transfers when Jazz defaults absent side amounts to zero', async () => {
		const f = linkedFixture()
		f.unlinkOne
			.mockReset()
			.mockResolvedValueOnce({
				id: transferId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				expenseAccountId,
				incomeAccountId,
				expenseAmountMinor: 0,
				expenseCurrency: null,
				incomeAmountMinor: 0,
				incomeCurrency: null,
				amountMinor: 4500,
				currency: 'USD'
			} satisfies InternalTransfer)
			.mockResolvedValueOnce({ ...expense, internalTransferId: transferId })
			.mockResolvedValueOnce({ ...income, internalTransferId: transferId })
			.mockResolvedValueOnce(membership)
		f.unlinkAll.mockReset().mockResolvedValueOnce([
			{ accountId: expenseAccountId, access: 'write', canDelete: true },
			{ accountId: incomeAccountId, access: 'write', canDelete: true }
		])
		const done = await waitFor(
			f.deleteActor({ kind: 'both' }),
			(snapshot) => snapshot.status === 'done'
		)

		expect(done.output).toMatchObject({
			outcome: 'succeeded',
			deletedTransactionIds: [expenseId, incomeId]
		})
	})

	it('reports recovery when cancelled after marker clearing is locally durable', async () => {
		const f = linkedFixture()
		const firstSettlement = Promise.withResolvers<void>()
		f.unlinkWait.mockImplementationOnce(() => firstSettlement.promise)
		const actor = f.deleteActor({ kind: 'both' })
		await vi.waitFor(() =>
			expect(actor.getSnapshot().matches({ running: { work: 'settlingClearWrite' } })).toBe(true)
		)
		actor.send({ type: 'CANCEL' })
		firstSettlement.resolve()
		const done = await waitFor(actor, (snapshot) => snapshot.status === 'done')

		expect(done.output).toMatchObject({
			outcome: 'recoveryRequired',
			phase: 'clearingMarkers',
			settlement: 'locallyPersisted'
		})
		expect(f.deleteTransaction).toHaveBeenCalledOnce()
	})

	it('reports the failed local delete phase after the unlink phase settled', async () => {
		const f = linkedFixture()
		const error = new Error('local delete unavailable')
		f.deleteTransaction.mockResolvedValueOnce({
			txId: Promise.resolve('clear-markers'),
			wait: f.unlinkWait
		})
		f.deleteTransaction.mockRejectedValueOnce(error)
		const done = await waitFor(
			f.deleteActor({ kind: 'both' }),
			(snapshot) => snapshot.status === 'done'
		)

		expect(done.output).toMatchObject({
			outcome: 'recoveryRequired',
			phase: 'deletingRecords',
			settlement: 'locallyPersisted',
			error
		})
	})
})
