import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { schema as s } from 'jazz-tools'
import type { RowRefValue } from 'jazz-tools/permissions'
import { createPolicyTestApp, type PolicyTestApp, type TestDb } from 'jazz-tools/testing'
import { checkReferenceCondition } from './check-reference-permissions.js'
import {
	checksSchema,
	transactionCheckColumns,
	transactionCheckRelations
} from '../schema/checks.js'

const app = s.defineApp(
	{
		organizations: s.table({ name: s.string() }, {}),
		accounts: s.table(
			{ organizationId: s.uuid() },
			{ organization: s.rel('organizations', 'organizationId') }
		),
		...checksSchema,
		transactions: s.table(
			{
				organizationId: s.uuid(),
				accountId: s.uuid(),
				kind: s.enum('income', 'expense'),
				paymentMethod: s.enum('cash', 'check', 'transfer', 'electronic').optional(),
				...transactionCheckColumns
			},
			{
				...transactionCheckRelations,
				organization: s.rel('organizations', 'organizationId'),
				account: s.rel('accounts', 'accountId')
			}
		)
	},
	{ migrations: 'none' }
)
const permissions = s.definePermissions(app, ({ policy, allOf }) => {
	const checkAccess = (accountId: string | RowRefValue, organizationId: string | RowRefValue) =>
		policy.accounts.exists.where({ id: accountId, organizationId })
	policy.organizations.allowRead.always()
	policy.accounts.allowRead.always()
	policy.checks.allowRead.where((row) => checkAccess(row.accountId, row.organizationId))
	policy.checks.allowInsert.where((row) => checkAccess(row.accountId, row.organizationId))
	policy.checks.allowUpdate
		.whereOld((row) => checkAccess(row.accountId, row.organizationId))
		.whereNew((row) =>
			allOf([
				checkAccess(row.accountId, row.organizationId),
				policy.checks.exists.where({
					id: row.id,
					organizationId: row.organizationId,
					accountId: row.accountId
				})
			])
		)
	policy.checks.allowDelete.never()
	const transactionReferenceIsValid = (
		row: import('jazz-tools/permissions').RowContext<s.RowOf<typeof app.transactions>>
	) =>
		allOf([
			checkAccess(row.accountId, row.organizationId),
			checkReferenceCondition({
				transaction: row,
				checkExists: (where) => policy.checks.exists.where(where)
			})
		])
	policy.transactions.allowRead.where((row) => checkAccess(row.accountId, row.organizationId))
	policy.transactions.allowInsert.where(transactionReferenceIsValid)
	policy.transactions.allowUpdate
		.whereOld((row) => checkAccess(row.accountId, row.organizationId))
		.whereNew(transactionReferenceIsValid)
	policy.transactions.allowDelete.never()
})

const organizationId = crypto.randomUUID()
const accountId = crypto.randomUUID()
const foreignOrganizationId = crypto.randomUUID()
const foreignAccountId = crypto.randomUUID()
let fixture: PolicyTestApp
let db: TestDb

async function createCheck(scope = { organizationId, accountId }) {
	return db
		.insert(app.checks, {
			...scope,
			checkNumber: crypto.randomUUID().slice(0, 8),
			checkDate: '2026-10-23'
		})
		.wait({ tier: 'global' })
}
function transactionValues(
	kind: 'income' | 'expense',
	checkId?: string,
	scope = { organizationId, accountId }
): s.InsertOf<typeof app.transactions> {
	return checkId ? { ...scope, kind, checkId, paymentMethod: 'check' } : { ...scope, kind }
}

beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	db = fixture.as({ user_id: 'check-reference-writer', authMode: 'local-first', claims: {} })
	await fixture.seed((seed) =>
		seed.insert(app.organizations, { name: 'Primary' }, { id: organizationId })
	)
	await fixture.seed((seed) => seed.insert(app.accounts, { organizationId }, { id: accountId }))
	await fixture.seed((seed) =>
		seed.insert(app.organizations, { name: 'Other' }, { id: foreignOrganizationId })
	)
	await fixture.seed((seed) =>
		seed.insert(app.accounts, { organizationId: foreignOrganizationId }, { id: foreignAccountId })
	)
}, 30_000)
afterAll(async () => {
	await fixture?.shutdown()
})

describe('transaction Check references', () => {
	it.each(['income', 'expense'] satisfies ('income' | 'expense')[])(
		'allows Check references and multiple transactions for %s',
		async (kind) => {
			const check = await createCheck()
			const first = await db
				.insert(app.transactions, transactionValues(kind, check.id))
				.wait({ tier: 'global' })
			const second = await db
				.insert(app.transactions, transactionValues(kind, check.id))
				.wait({ tier: 'global' })
			expect(first.checkId).toBe(check.id)
			expect(second.checkId).toBe(check.id)
			expect(second.id).not.toBe(first.id)
		}
	)

	it.each([
		['missing method', { checkId: crypto.randomUUID() }],
		['wrong method', { checkId: crypto.randomUUID(), paymentMethod: 'cash' }],
		['missing Check', { checkId: crypto.randomUUID(), paymentMethod: 'check' }]
	] satisfies [string, Partial<s.InsertOf<typeof app.transactions>>][])(
		'rejects a %s reference pairing',
		async (_description, patch) => {
			await expect(
				db.expectDenied((target) =>
					target.insert(app.transactions, {
						...transactionValues('expense'),
						...patch
					})
				)
			).resolves.toBeUndefined()
		}
	)

	it('rejects references that cross organization or account scope', async () => {
		const check = await createCheck()
		await expect(
			db.expectDenied((target) =>
				target.insert(
					app.transactions,
					transactionValues('income', check.id, {
						organizationId: foreignOrganizationId,
						accountId: foreignAccountId
					})
				)
			)
		).resolves.toBeUndefined()
	})

	it('checks reference compatibility on direct transaction updates', async () => {
		const check = await createCheck()
		const transaction = await db
			.insert(app.transactions, transactionValues('expense'))
			.wait({ tier: 'global' })
		await db
			.update(app.transactions, transaction.id, { checkId: check.id, paymentMethod: 'check' })
			.wait({ tier: 'global' })
		const otherCheck = await createCheck({
			organizationId: foreignOrganizationId,
			accountId: foreignAccountId
		})
		await expect(
			db.expectDenied((target) =>
				target.update(app.transactions, transaction.id, {
					checkId: otherCheck.id,
					paymentMethod: 'check'
				})
			)
		).resolves.toBeUndefined()
	})
})
