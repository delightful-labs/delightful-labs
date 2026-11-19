import { afterAll, beforeAll, expect, it } from 'vitest'
import { createJazz, memory, sqlite } from 'jazz-tools/backend'
import { app } from './jazz.generated.js'
import permissions from './jazz.permissions.json' with { type: 'json' }
import retained from '../../retained-baseline.json' with { type: 'json' }

const owner = () =>
	createJazz({
		app,
		permissions,
		store: sqlite({ path: retained.directory }),
		authenticate: async () => null
	})
let authority: ReturnType<typeof createJazz>

beforeAll(async () => {
	authority = createJazz({ app, permissions, store: memory(), authenticate: async () => null })
	await authority.ready()
})
afterAll(async () => {
	await authority.close()
})

it('opens actual alpha.60 records and retains new writes through another native close/reopen', async () => {
	const first = owner()
	try {
		await first.ready()
		expect(first.appId).toBe(retained.appId)
		expect(await first.db.one(app.accounts.where({ id: retained.ids.account }))).toMatchObject({
			name: 'Retained account',
			currency: 'USD'
		})
		expect(await first.db.one(app.checks.where({ id: retained.ids.check }))).toMatchObject({
			checkNumber: 'retained-check',
			checkDate: '2026-11-16'
		})
		expect(
			await first.db.one(app.transactions.where({ id: retained.ids.transaction }))
		).toMatchObject({
			amountMinor: Number.MAX_SAFE_INTEGER,
			bookedOn: '2026-11-16',
			externalId: 'retained-provider-id',
			currency: 'USD'
		})
		// Native null passthrough fixes the old transform's Number(null) conversion.
		expect(
			await first.db.one(app.internalTransfers.where({ id: retained.ids.transfer }))
		).toMatchObject({ amountMinor: 0, expenseAmountMinor: null, incomeAmountMinor: null })
		await first.db
			.update(app.transactions, retained.ids.transaction, {
				amountMinor: Number.MAX_SAFE_INTEGER - 1
			})
			.wait({ tier: 'global' })
	} finally {
		await first.close()
	}
	const reopened = owner()
	try {
		await reopened.ready()
		expect(
			await reopened.db.one(app.transactions.where({ id: retained.ids.transaction }))
		).toMatchObject({
			amountMinor: Number.MAX_SAFE_INTEGER - 1,
			externalId: 'retained-provider-id'
		})
	} finally {
		await reopened.close()
	}
})

const transfer = () => ({
	organizationId: crypto.randomUUID(),
	expenseTransactionId: crypto.randomUUID(),
	incomeTransactionId: crypto.randomUUID()
})

it.each([0, Number.MAX_SAFE_INTEGER])(
	'round trips %s minor units through the native BigInt transform',
	async (amountMinor) => {
		const id = crypto.randomUUID()
		await authority.db
			.insert(
				app.internalTransfers,
				{ ...transfer(), amountMinor, expenseAmountMinor: null, incomeAmountMinor: null },
				{ id }
			)
			.wait({ tier: 'global' })
		expect(await authority.db.one(app.internalTransfers.where({ id }))).toMatchObject({
			amountMinor,
			expenseAmountMinor: null,
			incomeAmountMinor: null
		})
	}
)

it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
	'refuses invalid minor-unit input %s before storage',
	async (amountMinor) => {
		await expect(
			Promise.resolve().then(() =>
				authority.db
					.insert(app.internalTransfers, { ...transfer(), amountMinor })
					.wait({ tier: 'global' })
			)
		).rejects.toThrow()
	}
)

it('preserves nullable and zero bank-sync counts', async () => {
	const id = crypto.randomUUID()
	await authority.db
		.insert(
			app.simplefinSyncAttempts,
			{
				organizationId: crypto.randomUUID(),
				connectionId: crypto.randomUUID(),
				initiatedBy: crypto.randomUUID(),
				startedAt: new Date(),
				outcome: 'unfinished',
				importSettlement: 'notStarted',
				importedCount: null,
				existingCount: 0,
				omittedCount: 2_147_483_647
			},
			{ id }
		)
		.wait({ tier: 'global' })
	expect(await authority.db.one(app.simplefinSyncAttempts.where({ id }))).toMatchObject({
		importedCount: null,
		existingCount: 0,
		omittedCount: 2_147_483_647
	})
})

it('keeps account-name normalization and validation in the native named transform', async () => {
	const id = crypto.randomUUID(),
		organizationId = crypto.randomUUID()
	await authority.db
		.insert(
			app.accounts,
			{ organizationId, name: '  Cash  ', kind: 'cash', currency: 'USD' },
			{ id }
		)
		.wait({ tier: 'global' })
	expect(await authority.db.one(app.accounts.where({ id }))).toMatchObject({
		name: 'Cash',
		currency: 'USD'
	})
	await expect(
		Promise.resolve().then(() =>
			authority.db
				.insert(app.accounts, { organizationId, name: '   ', kind: 'cash', currency: 'USD' })
				.wait({ tier: 'global' })
		)
	).rejects.toThrow()
})
