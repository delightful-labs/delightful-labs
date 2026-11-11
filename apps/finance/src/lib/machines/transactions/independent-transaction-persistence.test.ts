import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import { app } from '#lib/schema.js'
import type { Tag } from '#lib/schema.js'
import {
	createIndependentTransactionPersistenceMachine,
	type IndependentTransactionInput
} from './independent-transaction-persistence.js'
import { createActor, toPromise, waitFor, createAsyncLogic } from 'xstate'

const transactionId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const accountId = '33333333-3333-4333-8333-333333333333'
const categoryId = '44444444-4444-4444-8444-444444444444'
const transferId = '77777777-7777-4777-8777-777777777777'
const input: IndependentTransactionInput = {
	transactionId,
	values: {
		organizationId,
		accountId,
		categoryId,
		kind: 'expense',
		bookedOn: '2026-10-23',
		money: { amountMinor: 1234, currency: 'USD' },
		source: { source: 'manual' },
		paymentMethod: 'check',
		checkId: '55555555-5555-4555-8555-555555555555',
		tags: [' Garden ']
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
	const all = vi.spyOn(tx, 'all').mockResolvedValue([])
	const rollback = vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	const wait = vi.fn(async (_options: { tier: 'local' }) => {})
	const commit = vi.spyOn(tx, 'commit').mockImplementation(vi.fn().mockReturnValue({ wait }))
	const beginTransaction = vi.fn(() => tx)
	const machine = createIndependentTransactionPersistenceMachine({ beginTransaction })
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
	return { tx, insert, all, rollback, wait, commit, beginTransaction, machine, start }
}

const existingTag: Tag = {
	id: '66666666-6666-4666-8666-666666666666',
	organizationId,
	kind: 'expense',
	name: 'Garden',
	categoryId: '77777777-7777-4777-8777-777777777777',
	archivedAt: null
}

describe('independent transaction persistence', () => {
	it('atomically writes a transaction with a Check reference and creates and assigns a typed tag', async () => {
		const f = fixture()
		const result = await toPromise(f.start())
		expect(result).toEqual({ outcome: 'succeeded', transactionId, settlement: 'locallyPersisted' })
		expect(f.beginTransaction).toHaveBeenCalledTimes(1)
		expect(f.insert).toHaveBeenCalledWith(
			app.transactions,
			expect.objectContaining({
				organizationId,
				accountId,
				categoryId,
				kind: 'expense',
				amountMinor: 1234,
				paymentMethod: 'check',
				checkId: input.values.checkId
			}),
			{ id: transactionId }
		)
		expect(f.insert).toHaveBeenCalledWith(
			app.tags,
			{ organizationId, kind: 'expense', name: 'Garden', categoryId, archivedAt: null },
			expect.objectContaining({ id: expect.any(String) })
		)
		expect(f.insert).toHaveBeenCalledWith(
			app.transactionTags,
			expect.objectContaining({ organizationId, transactionId })
		)
		expect(f.wait).toHaveBeenCalledWith({ tier: 'local' })
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('reuses a matching active tag without changing its category', async () => {
		const f = fixture()
		f.all.mockResolvedValue([existingTag])
		await expect(toPromise(f.start())).resolves.toMatchObject({ outcome: 'succeeded' })
		expect(f.insert.mock.calls.filter(([table]) => table === app.tags)).toHaveLength(0)
		expect(f.insert).toHaveBeenCalledWith(app.transactionTags, {
			organizationId,
			transactionId,
			tagId: existingTag.id
		})
	})

	it('rejects a selected tag archived before transaction persistence', async () => {
		const f = fixture()
		f.all.mockResolvedValue([{ ...existingTag, archivedAt: new Date('2026-10-23') }])
		await expect(toPromise(f.start())).resolves.toMatchObject({
			outcome: 'failed',
			settlement: 'rejected'
		})
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('does not query tags when no tags are selected', async () => {
		const f = fixture()
		await expect(
			toPromise(f.start({ ...input, values: { ...input.values, tags: [] } }))
		).resolves.toMatchObject({ outcome: 'succeeded' })
		expect(f.all).not.toHaveBeenCalled()
		expect(f.insert).toHaveBeenCalledTimes(1)
	})

	it('rejects malformed data before opening a transaction', async () => {
		const f = fixture()
		await expect(toPromise(f.start({ ...input, transactionId: 'invalid' }))).resolves.toMatchObject(
			{ outcome: 'failed', settlement: 'notStarted' }
		)
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})

	it('handles transaction acquisition failure without attempting rollback', async () => {
		const f = fixture()
		f.beginTransaction.mockImplementation(() => {
			throw new Error('open failed')
		})
		await expect(toPromise(f.start())).resolves.toEqual({
			outcome: 'failed',
			transactionId,
			settlement: 'notStarted'
		})
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('rolls back ambiguous tags without staging writes', async () => {
		const f = fixture()
		f.all.mockResolvedValue([
			existingTag,
			{ ...existingTag, id: '88888888-8888-4888-8888-888888888888', name: ' garden ' }
		])
		await expect(toPromise(f.start())).resolves.toMatchObject({
			outcome: 'failed',
			settlement: 'rejected'
		})
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})

	it('rolls back a staging failure and reports confirmed rejection', async () => {
		const f = fixture()
		f.insert.mockImplementation(() => {
			throw new Error('stage failed')
		})
		await expect(toPromise(f.start())).resolves.toEqual({
			outcome: 'failed',
			transactionId,
			settlement: 'rejected'
		})
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})

	it('preserves an unknown outcome when commit fails', async () => {
		const f = fixture()
		f.commit.mockImplementation(() => {
			throw new Error('commit failed')
		})
		await expect(toPromise(f.start())).resolves.toMatchObject({
			outcome: 'failed',
			settlement: 'unknown'
		})
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})
})

describe('linked transaction edit safety', () => {
	function linkedEditFixture(marker: string | null) {
		const f = fixture()
		const existing = {
			id: transactionId,
			organizationId,
			accountId,
			categoryId,
			kind: 'expense',
			source: 'manual',
			externalId: null,
			amountMinor: 1234,
			currency: 'USD',
			bookedOn: input.values.bookedOn,
			description: null,
			memo: null,
			paymentMethod: 'check',
			checkId: input.values.checkId,
			checkDetailsId: null,
			batchId: null,
			internalTransferId: marker
		}
		const transfer = {
			id: transferId,
			organizationId,
			expenseTransactionId: transactionId,
			incomeTransactionId: '88888888-8888-4888-8888-888888888888',
			expenseAccountId: accountId,
			incomeAccountId: '99999999-9999-4999-8999-999999999999',
			amountMinor: 1234,
			currency: 'USD'
		}
		f.all
			.mockResolvedValueOnce([existing])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([transfer])
			.mockResolvedValueOnce([])
		return f
	}

	it('allows metadata edits while retaining the linked pair', async () => {
		const f = linkedEditFixture(transferId)
		const update = vi.spyOn(f.tx, 'update').mockImplementation(() => {})
		const result = await toPromise(
			f.start({
				...input,
				mode: 'edit',
				values: {
					...input.values,
					bookedOn: '2026-10-24',
					description: 'Payment',
					tags: []
				}
			})
		)
		expect(result).toMatchObject({ outcome: 'succeeded', settlement: 'locallyPersisted' })
		expect(update).toHaveBeenCalledWith(
			app.transactions,
			transactionId,
			expect.objectContaining({ bookedOn: '2026-10-24', description: 'Payment' })
		)
	})

	it('rolls back a one-sided amount change while the unlink relationship remains', async () => {
		const f = linkedEditFixture(null)
		const result = await toPromise(
			f.start({
				...input,
				mode: 'edit',
				values: {
					...input.values,
					money: { amountMinor: 1235, currency: 'USD' },
					tags: []
				}
			})
		)
		expect(result).toEqual({
			outcome: 'failed',
			transactionId,
			settlement: 'rejected',
			reason: 'linkedTransferRequiresUnlink'
		})
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})
})

describe('independent transaction interruptions', () => {
	it('cancels before persistence without opening a transaction', async () => {
		const f = fixture()
		const actor = f.start()
		actor.send({ type: 'CANCEL' })
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'cancelled',
			transactionId,
			settlement: 'notStarted'
		})
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})

	it('drains transaction acquisition after invalidation without staging writes', async () => {
		const f = fixture()
		const opened = Promise.withResolvers<typeof f.tx>()
		const actor = f.start(
			input,
			f.machine.provide({ actors: { open: createAsyncLogic({ run: () => opened.promise }) } })
		)
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { flow: 'opening' } }))
		actor.send({ type: 'INVALIDATE' })
		opened.resolve(f.tx)
		await expect(toPromise(actor)).resolves.toMatchObject({
			outcome: 'scopeChanged',
			settlement: 'rejected'
		})
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})

	it('rolls back staged writes when cancelled before commit', async () => {
		const f = fixture()
		const staged = Promise.withResolvers<void>()
		const actor = f.start(
			input,
			f.machine.provide({ actors: { stage: createAsyncLogic({ run: () => staged.promise }) } })
		)
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { flow: 'staging' } }))
		actor.send({ type: 'CANCEL' })
		staged.resolve()
		await expect(toPromise(actor)).resolves.toMatchObject({
			outcome: 'cancelled',
			settlement: 'rejected'
		})
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})
})

describe('atomic Check account move resource ownership', () => {
	it.each(['success', 'stage-failure', 'settlement-unknown'])(
		'stages both updates in one transaction and classifies %s',
		async (scenario) => {
			const f = fixture()
			const targetAccountId = '88888888-8888-4888-8888-888888888888'
			const checkId = '55555555-5555-4555-8555-555555555555'
			const update = vi.spyOn(f.tx, 'update').mockImplementation(() => {})
			f.all
				.mockResolvedValueOnce([
					{
						id: transactionId,
						organizationId,
						accountId,
						categoryId,
						kind: 'expense',
						source: 'manual',
						externalId: null,
						amountMinor: 1234,
						currency: 'USD',
						bookedOn: input.values.bookedOn,
						description: null,
						memo: null,
						paymentMethod: 'check',
						checkId,
						checkDetailsId: null,
						batchId: null
					}
				])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					{
						id: checkId,
						organizationId,
						accountId,
						checkNumber: '101',
						checkDate: input.values.bookedOn,
						payerName: null,
						bankName: null,
						memoOnCheck: null
					}
				])
				.mockResolvedValueOnce([])
			if (scenario === 'stage-failure')
				update.mockImplementationOnce(() => {
					throw new Error('Cannot stage Check move')
				})
			if (scenario === 'settlement-unknown')
				f.wait.mockRejectedValue(new Error('Durability unknown'))
			const result = await toPromise(
				f.start({
					...input,
					mode: 'edit',
					moveCheckFromAccountId: accountId,
					values: { ...input.values, accountId: targetAccountId, tags: [] }
				})
			)
			expect(f.beginTransaction).toHaveBeenCalledOnce()
			expect(update).toHaveBeenCalledWith(app.checks, checkId, { accountId: targetAccountId })
			if (scenario === 'stage-failure') {
				expect(result).toMatchObject({ outcome: 'failed', settlement: 'rejected' })
				expect(f.commit).not.toHaveBeenCalled()
				expect(f.rollback).toHaveBeenCalledOnce()
			} else {
				expect(update).toHaveBeenCalledWith(
					app.transactions,
					transactionId,
					expect.objectContaining({ accountId: targetAccountId, checkId })
				)
				expect(f.commit).toHaveBeenCalledOnce()
				expect(result).toMatchObject(
					scenario === 'success'
						? { outcome: 'succeeded', settlement: 'locallyPersisted' }
						: { outcome: 'failed', settlement: 'unknown' }
				)
				if (scenario === 'settlement-unknown') expect(f.rollback).toHaveBeenCalledOnce()
			}
		}
	)
})
