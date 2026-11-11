import { afterEach, expect, it, vi } from 'vitest'
import { ReadTier } from 'jazz-tools'
import { fakeDataSetup } from './fake-data.js'
import { prepareFakeData } from '../../domain/fake-data.js'
import { categories, organizationId, organization, seedFixture } from './fake-data.fixture.js'
import { createActor, toPromise, waitFor } from 'xstate'

afterEach(() => vi.restoreAllMocks())

it('generates valid related data, integer amounts, both directions and stable namespaced IDs', async () => {
	const first = await prepareFakeData(organizationId, categories)
	const second = await prepareFakeData(organizationId, categories)
	expect(first.accounts.map((row) => row.values.kind)).toEqual(['cash', 'bank', 'card'])
	expect(first.transactions).toHaveLength(120)
	expect(first.accounts.map((row) => row.id)).toEqual(second.accounts.map((row) => row.id))
	expect(first.transactions.map((row) => row.id)).toEqual(second.transactions.map((row) => row.id))
	const accountIds = new Set(first.accounts.map((row) => row.id))
	expect(new Set(first.transactions.map((row) => row.id)).size).toBe(120)
	expect(new Set(first.transactions.map((row) => row.values.kind))).toEqual(
		new Set(['income', 'expense'])
	)
	for (const { values } of first.transactions) {
		expect(accountIds.has(values.accountId)).toBe(true)
		expect(Number.isSafeInteger(values.amountMinor) && values.amountMinor >= 0).toBe(true)
		expect(
			categories.some(
				(category) => category.id === values.categoryId && category.kind === values.kind
			)
		).toBe(true)
		expect(values.description?.length).toBeGreaterThan(0)
		expect(values.bookedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	}
})

it('confirms all 123 inserts as a single serializable write and releases resources', async () => {
	const f = seedFixture()
	const confirmation = Promise.withResolvers<void>()
	f.wait.mockReturnValue(confirmation.promise)
	const actor = createActor(fakeDataSetup, { input: f.input }).start()
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'settling' } }))
	expect(f.beginSerializableTransaction).toHaveBeenCalledOnce()
	expect(f.insert).toHaveBeenCalledTimes(123)
	expect(f.commit).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().status).toBe('active')
	expect(f.all.mock.calls.slice(2).every((call) => call[1]?.tier === ReadTier.Remote)).toBe(true)
	confirmation.resolve()
	expect(await toPromise(actor)).toEqual({
		outcome: 'seeded',
		settlement: 'confirmed',
		accountCount: 3,
		transactionCount: 120
	})
	expect(actor.getSnapshot().context.tx).toBeUndefined()
	expect(actor.getSnapshot().context.plan).toBeUndefined()
})

it.each([0, 1])(
	'skips local existing finance data in read %s without a network read',
	async (index) => {
		const f = seedFixture()
		f.all.mockReset().mockResolvedValue([])
		if (index === 0) f.all.mockResolvedValueOnce([{ id: organizationId }])
		else f.all.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: organizationId }])
		expect(await toPromise(createActor(fakeDataSetup, { input: f.input }).start())).toEqual({
			outcome: 'skipped',
			settlement: 'notStarted'
		})
		expect(f.all).toHaveBeenCalledTimes(2)
		expect(f.beginSerializableTransaction).not.toHaveBeenCalled()
	}
)

it.each(['remoteData', 'notOwner', 'missingCategories'])(
	'does not write for %s',
	async (reason) => {
		const f = seedFixture()
		f.all.mockReset().mockResolvedValue([])
		f.all
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(reason === 'remoteData' ? [{ id: organizationId }] : [])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ ...organization, ownerId: reason === 'notOwner' ? 'another-user' : organization.ownerId }
			])
			.mockResolvedValueOnce(reason === 'missingCategories' ? [] : categories)
		const result = await toPromise(createActor(fakeDataSetup, { input: f.input }).start())
		expect(result.outcome).toBe(reason === 'missingCategories' ? 'failed' : 'skipped')
		expect(f.beginSerializableTransaction).not.toHaveBeenCalled()
	}
)

it('rechecks emptiness in the acquired transaction and rolls back when data arrived', async () => {
	const f = seedFixture()
	f.recheck.mockReset().mockResolvedValue([])
	f.recheck
		.mockResolvedValueOnce([{ id: organizationId }])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([organization])
		.mockResolvedValueOnce(categories)
	expect(await toPromise(createActor(fakeDataSetup, { input: f.input }).start())).toEqual({
		outcome: 'skipped',
		settlement: 'notStarted'
	})
	expect(f.rollback).toHaveBeenCalledOnce()
	expect(f.insert).not.toHaveBeenCalled()
	expect(f.commit).not.toHaveBeenCalled()
})

it.each(['stage', 'confirmation', 'rollback'])(
	'reports %s failures without claiming success',
	async (phase) => {
		const f = seedFixture()
		if (phase === 'stage' || phase === 'rollback')
			f.insert.mockImplementation(() => {
				throw new Error('Insert failed')
			})
		if (phase === 'confirmation') f.wait.mockRejectedValue(new Error('Authority rejected'))
		if (phase === 'rollback') f.rollback.mockResolvedValue(false)
		const result = await toPromise(createActor(fakeDataSetup, { input: f.input }).start())
		expect(result).toMatchObject({
			outcome: 'failed',
			settlement: phase === 'stage' ? 'notStarted' : 'unresolved'
		})
		expect(f.rollback).toHaveBeenCalledOnce()
	}
)

it('cancels an outstanding authoritative read and ignores its late completion', async () => {
	const f = seedFixture()
	const remote = Promise.withResolvers<[]>()
	f.all
		.mockReset()
		.mockResolvedValue([])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([])
		.mockReturnValue(remote.promise)
	const actor = createActor(fakeDataSetup, { input: f.input }).start()
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'readingAuthority' } }))
	actor.send({ type: 'CANCEL' })
	expect(await toPromise(actor)).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
	remote.resolve([])
	await Promise.resolve()
	expect(f.beginSerializableTransaction).not.toHaveBeenCalled()
})

it('drains a recheck and rolls back before acknowledging shutdown', async () => {
	const f = seedFixture()
	const recheck = Promise.withResolvers<[]>()
	f.recheck.mockReset().mockReturnValue(recheck.promise)
	const actor = createActor(fakeDataSetup, { input: f.input }).start()
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'rechecking' } }))
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	recheck.resolve([])
	expect(await toPromise(actor)).toEqual({ outcome: 'closed', settlement: 'notStarted' })
	expect(f.rollback).toHaveBeenCalledOnce()
	expect(f.insert).not.toHaveBeenCalled()
})

it('awaits authority confirmation when cancellation arrives after commit', async () => {
	const f = seedFixture()
	const confirmation = Promise.withResolvers<void>()
	f.wait.mockReturnValue(confirmation.promise)
	const actor = createActor(fakeDataSetup, { input: f.input }).start()
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'settling' } }))
	actor.send({ type: 'CANCEL' })
	expect(actor.getSnapshot().status).toBe('active')
	confirmation.resolve()
	expect(await toPromise(actor)).toEqual({ outcome: 'cancelled', settlement: 'confirmed' })
	expect(f.rollback).not.toHaveBeenCalled()
})

it.each(['owner', 'categories'])(
	'rolls back if %s changes before transaction staging',
	async (changed) => {
		const f = seedFixture()
		f.recheck.mockReset().mockResolvedValue([])
		f.recheck
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ ...organization, ownerId: changed === 'owner' ? 'another-user' : organization.ownerId }
			])
			.mockResolvedValueOnce(changed === 'categories' ? [] : categories)
		const result = await toPromise(createActor(fakeDataSetup, { input: f.input }).start())
		expect(result.outcome).toBe(changed === 'owner' ? 'skipped' : 'failed')
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
	}
)
