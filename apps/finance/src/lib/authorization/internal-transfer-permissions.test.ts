import type { InsertOf } from 'jazz-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPolicyTestApp, type PolicyTestApp, type TestDb } from 'jazz-tools/testing'
import { app } from '../../../tests/fixtures/authorization/internal-transfer/jazz.generated.js'
import permissions from '../../../tests/fixtures/authorization/internal-transfer/jazz.permissions.json' with { type: 'json' }

const organizationId = crypto.randomUUID()
const foreignOrganizationId = crypto.randomUUID()
const expenseAccountId = crypto.randomUUID()
const incomeAccountId = crypto.randomUUID()
const expenseTransactionId = crypto.randomUUID()
const incomeTransactionId = crypto.randomUUID()
const transferId = crypto.randomUUID()
const session = {
	user_id: 'internal-transfer-policy-test',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
let fixture: PolicyTestApp
let db: TestDb

function transfer(
	overrides: Partial<import('jazz-tools').InsertOf<typeof app.internalTransfers>> = {}
) {
	return {
		organizationId,
		expenseTransactionId,
		incomeTransactionId,
		expenseAccountId,
		incomeAccountId,
		expenseAmountMinor: '4500',
		expenseCurrency: 'USD',
		incomeAmountMinor: '4500',
		incomeCurrency: 'USD',
		amountMinor: '4500',
		currency: 'USD',
		...overrides
	} satisfies import('jazz-tools').InsertOf<typeof app.internalTransfers>
}

beforeEach(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	db = fixture.as(session)
	await fixture.seed((seed) =>
		seed.insert(
			app.transactions,
			{
				organizationId,
				accountId: expenseAccountId,
				kind: 'expense',
				amountMinor: '4500',
				currency: 'USD',
				internalTransferId: transferId
			},
			{ id: expenseTransactionId }
		)
	)
	await fixture.seed((seed) =>
		seed.insert(
			app.transactions,
			{
				organizationId,
				accountId: incomeAccountId,
				kind: 'income',
				amountMinor: '4500',
				currency: 'USD',
				internalTransferId: transferId
			},
			{ id: incomeTransactionId }
		)
	)
}, 30_000)

afterEach(async () => {
	await fixture?.shutdown()
})

describe('positive Check-style transfer endpoint lookups', () => {
	it('rejects deleting the relationship while endpoint markers remain set', async () => {
		const saved = await db
			.insert(app.internalTransfers, transfer(), { id: transferId })
			.wait({ tier: 'global' })
		expect(saved.expenseTransactionId).toBe(expenseTransactionId)

		await expect(
			db.expectDenied((writer) => writer.delete(app.internalTransfers, transferId))
		).resolves.toBeUndefined()
	})

	it('retains the original relationship when native delete admission rejects clearing both markers atomically', async () => {
		await db.insert(app.internalTransfers, transfer(), { id: transferId }).wait({ tier: 'global' })
		const unlink = await db.transaction((tx) => {
			tx.update(app.transactions, expenseTransactionId, { internalTransferId: null })
			tx.update(app.transactions, incomeTransactionId, { internalTransferId: null })
			tx.delete(app.internalTransfers, transferId)
		})
		await expect(unlink.wait({ tier: 'global' })).rejects.toMatchObject({
			code: 'permission_denied'
		})
		expect(
			await db.one(app.internalTransfers.where({ id: transferId }), { tier: 'remote' })
		).toMatchObject({ id: transferId })
		expect(
			await db.one(app.transactions.where({ id: expenseTransactionId }), { tier: 'remote' })
		).toMatchObject({ internalTransferId: transferId })
		expect(
			await db.one(app.transactions.where({ id: incomeTransactionId }), { tier: 'remote' })
		).toMatchObject({ internalTransferId: transferId })
	})

	it('accepts clearing both endpoint markers before deleting the relationship', async () => {
		await db.insert(app.internalTransfers, transfer(), { id: transferId }).wait({ tier: 'global' })
		const clearMarkers = await db.transaction((tx) => {
			tx.update(app.transactions, expenseTransactionId, { internalTransferId: null })
			tx.update(app.transactions, incomeTransactionId, { internalTransferId: null })
		})
		await clearMarkers.wait({ tier: 'global' })
		await db.delete(app.internalTransfers, transferId).wait({ tier: 'global' })
		expect(
			await db.one(app.internalTransfers.where({ id: transferId }), { tier: 'remote' })
		).toBeNull()
	})

	it('rejects deleting a transaction while an explicit Jazz relation still references it', async () => {
		await db.insert(app.internalTransfers, transfer(), { id: transferId }).wait({ tier: 'global' })
		const clearMarkers = await db.transaction((tx) => {
			tx.update(app.transactions, expenseTransactionId, { internalTransferId: null })
			tx.update(app.transactions, incomeTransactionId, { internalTransferId: null })
		})
		await clearMarkers.wait({ tier: 'global' })

		await expect(
			db.expectDenied((writer) => writer.delete(app.transactions, expenseTransactionId))
		).resolves.toBeUndefined()
		expect(
			(await db.one(app.transactions.where({ id: expenseTransactionId }), { tier: 'remote' }))?.id
		).toBe(expenseTransactionId)
	})

	it('rejects an endpoint that does not match its transaction facts', async () => {
		await expect(
			db.expectDenied((writer) =>
				writer.insert(app.internalTransfers, transfer({ organizationId: foreignOrganizationId }))
			)
		).resolves.toBeUndefined()
		await expect(
			db.expectDenied((writer) =>
				writer.insert(app.internalTransfers, transfer({ expenseAccountId: incomeAccountId }))
			)
		).resolves.toBeUndefined()
		await expect(
			db.expectDenied((writer) =>
				writer.insert(app.internalTransfers, transfer({ amountMinor: '4501' }))
			)
		).resolves.toBeUndefined()
		await expect(
			db.expectDenied((writer) =>
				writer.insert(app.internalTransfers, transfer({ currency: 'CAD' }))
			)
		).resolves.toBeUndefined()
	})

	it('accepts different endpoint amounts and currencies when each matches its transaction', async () => {
		const crossExpenseId = crypto.randomUUID()
		const crossIncomeId = crypto.randomUUID()
		const crossTransferId = crypto.randomUUID()
		await db
			.insert(
				app.transactions,
				{
					organizationId,
					accountId: expenseAccountId,
					kind: 'expense',
					amountMinor: '4217',
					currency: 'USD',
					internalTransferId: crossTransferId
				},
				{ id: crossExpenseId }
			)
			.wait({ tier: 'global' })
		await db
			.insert(
				app.transactions,
				{
					organizationId,
					accountId: incomeAccountId,
					kind: 'income',
					amountMinor: '6500000',
					currency: 'TZS',
					internalTransferId: crossTransferId
				},
				{ id: crossIncomeId }
			)
			.wait({ tier: 'global' })
		const saved = await db
			.insert(
				app.internalTransfers,
				transfer({
					expenseTransactionId: crossExpenseId,
					incomeTransactionId: crossIncomeId,
					expenseAmountMinor: '4217',
					expenseCurrency: 'USD',
					incomeAmountMinor: '6500000',
					incomeCurrency: 'TZS'
				}),
				{ id: crossTransferId }
			)
			.wait({ tier: 'global' })
		expect(saved.incomeAmountMinor).toBe('6500000')
		await expect(
			db.expectDenied((writer) =>
				writer.insert(
					app.internalTransfers,
					transfer({
						expenseTransactionId: crossExpenseId,
						incomeTransactionId: crossIncomeId,
						expenseAmountMinor: '4217',
						expenseCurrency: 'USD',
						incomeAmountMinor: '6500001',
						incomeCurrency: 'TZS'
					})
				)
			)
		).resolves.toBeUndefined()
	})
})
