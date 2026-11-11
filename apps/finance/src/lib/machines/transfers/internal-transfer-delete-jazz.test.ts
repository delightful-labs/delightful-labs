import { afterEach, describe, expect, it } from 'vitest'
import { createPolicyTestApp, type PolicyTestApp, type TestDb } from 'jazz-tools/testing'
import { app } from '../../schema.js'
import permissions from '../../permissions.js'

const session = {
	user_id: 'internal-transfer-delete-local-test',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
let fixture: PolicyTestApp | undefined

afterEach(async () => {
	await fixture?.shutdown()
	fixture = undefined
})

describe('Jazz local transfer deletion', () => {
	it('locally commits marker clearing followed by a mergeable delete bundle', async () => {
		fixture = await createPolicyTestApp(app, permissions, expect)
		const organizationId = crypto.randomUUID()
		const expenseAccountId = crypto.randomUUID()
		const incomeAccountId = crypto.randomUUID()
		const expenseCategoryId = crypto.randomUUID()
		const incomeCategoryId = crypto.randomUUID()
		const expenseTransactionId = crypto.randomUUID()
		const incomeTransactionId = crypto.randomUUID()
		const transferId = crypto.randomUUID()
		const ownerId = fixture.accountFor(session)
		const db: TestDb = fixture.as(session)

		await fixture.seed((seed) =>
			seed.insert(
				app.organizations,
				{
					name: 'Transfer delete local test',
					ownerId,
					kind: 'personal',
					defaultCurrency: 'USD'
				},
				{ id: organizationId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(app.organizationMembers, {
				organizationId,
				userId: ownerId,
				role: 'owner',
				accountAccessMode: 'all'
			})
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.accounts,
				{
					organizationId,
					name: 'Expense account',
					kind: 'cash',
					currency: 'USD'
				},
				{ id: expenseAccountId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.accounts,
				{
					organizationId,
					name: 'Income account',
					kind: 'cash',
					currency: 'USD'
				},
				{ id: incomeAccountId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.categories,
				{
					organizationId,
					name: 'Expense',
					kind: 'expense',
					isSystem: false
				},
				{ id: expenseCategoryId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.categories,
				{
					organizationId,
					name: 'Income',
					kind: 'income',
					isSystem: false
				},
				{ id: incomeCategoryId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{
					organizationId,
					accountId: expenseAccountId,
					categoryId: expenseCategoryId,
					kind: 'expense',
					amountMinor: 100,
					currency: 'USD',
					bookedOn: '2026-10-25',
					source: 'manual',
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
					categoryId: incomeCategoryId,
					kind: 'income',
					amountMinor: 100,
					currency: 'USD',
					bookedOn: '2026-10-25',
					source: 'manual',
					internalTransferId: transferId
				},
				{ id: incomeTransactionId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.internalTransfers,
				{
					organizationId,
					expenseTransactionId,
					incomeTransactionId,
					expenseAccountId,
					incomeAccountId,
					amountMinor: 100,
					currency: 'USD'
				},
				{ id: transferId }
			)
		)

		const clearMarkers = await db.transaction((tx) => {
			tx.update(app.transactions, expenseTransactionId, { internalTransferId: null })
			tx.update(app.transactions, incomeTransactionId, { internalTransferId: null })
		})
		await clearMarkers.wait({ tier: 'local' })
		const deleteBundle = await db.transaction((tx) => {
			tx.delete(app.internalTransfers, transferId)
			tx.delete(app.transactions, expenseTransactionId)
			tx.delete(app.transactions, incomeTransactionId)
		})
		await deleteBundle.wait({ tier: 'local' })

		expect(
			await db.one(app.internalTransfers.where({ id: transferId }), { tier: 'local-first' })
		).toBeNull()
		expect(
			await db.one(app.transactions.where({ id: expenseTransactionId }), { tier: 'local-first' })
		).toBeNull()
		expect(
			await db.one(app.transactions.where({ id: incomeTransactionId }), { tier: 'local-first' })
		).toBeNull()
	})
})
