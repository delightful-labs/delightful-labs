import { afterAll, beforeAll, expect, it } from 'vitest'
import {
	createPolicyTestApp,
	type PolicyTestApp,
	type PolicyTestSession,
	type TestDb
} from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createSyncLogRetentionMachine } from './machines/bank-sync/log-retention.js'
import type { RetentionScope } from './machines/bank-sync/log-retention.js'
import { createActor, toPromise } from 'xstate'

const ownerSession = {
	user_id: 'retention-owner',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const adminSession = {
	user_id: 'retention-admin',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const organizationId = crypto.randomUUID(),
	connectionId = crypto.randomUUID(),
	accountId = crypto.randomUUID()
const otherConnectionId = crypto.randomUUID(),
	otherAttemptId = crypto.randomUUID(),
	unfinishedId = crypto.randomUUID(),
	resultId = crypto.randomUUID()
const timestamp = new Date('2026-10-30T12:00:00Z')
const attemptId = (index: number) =>
	`11111111-1111-4111-8111-${index.toString(16).padStart(12, '0')}`
let fixture: PolicyTestApp, owner: TestDb, admin: TestDb, userId: string, scope: RetentionScope
function values(connection = connectionId) {
	return {
		organizationId,
		connectionId: connection,
		initiatedBy: userId,
		startedAt: timestamp,
		finishedAt: timestamp,
		outcome: 'succeeded',
		importSettlement: 'notStarted',
		importedCount: 0,
		existingCount: 0,
		omittedCount: 0
	} satisfies import('jazz-tools').schema.InsertOf<typeof app.simplefinSyncAttempts>
}
function run(db = owner, identity = userId) {
	return toPromise(
		createActor(
			createSyncLogRetentionMachine({
				db,
				observe: () => ({
					userId: identity,
					organizationId,
					allowed: true,
					connected: true,
					sessionReady: true,
					connection: undefined
				})
			}),
			{ input: { scope: { ...scope, userId: identity } } }
		).start()
	)
}
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	owner = fixture.as(ownerSession)
	admin = fixture.as(adminSession)
	userId = fixture.accountFor(ownerSession)
	scope = { organizationId, connectionId, userId }
	await fixture.seed((db) =>
		db.insert(
			app.organizations,
			{ name: 'Retention', kind: 'personal', defaultCurrency: 'USD', ownerId: userId },
			{ id: organizationId }
		)
	)
	for (const [session, role] of [
		[ownerSession, 'owner'],
		[adminSession, 'admin']
	] satisfies [PolicyTestSession, 'owner' | 'admin'][]) {
		await fixture.seed((db) =>
			db.insert(app.organizationMembers, {
				organizationId,
				userId: fixture.accountFor(session),
				role,
				accountAccessMode: 'all'
			})
		)
	}
	for (const id of [connectionId, otherConnectionId])
		await fixture.seed((db) =>
			db.insert(
				app.simplefinConnections,
				{ organizationId, ownerId: userId, accessUrl: '', status: 'active', claimedAt: timestamp },
				{ id }
			)
		)
	await fixture.seed((db) =>
		db.insert(
			app.accounts,
			{ organizationId, name: 'Checking', kind: 'bank', currency: 'USD' },
			{ id: accountId }
		)
	)
	await Promise.all(
		Array.from({ length: 100 }, (_, index) =>
			fixture.seed((db) =>
				db.insert(app.simplefinSyncAttempts, values(), { id: attemptId(index + 1) })
			)
		)
	)
	await fixture.seed((db) =>
		db.insert(
			app.simplefinSyncAccountResults,
			{
				organizationId,
				attemptId: attemptId(1),
				accountId,
				accountName: 'Historical Checking',
				outcome: 'succeeded',
				importedCount: 0,
				existingCount: 0,
				omittedCount: 0
			},
			{ id: resultId }
		)
	)
	await fixture.seed((db) =>
		db.insert(
			app.simplefinSyncAttempts,
			{ ...values(), outcome: 'unfinished', finishedAt: null },
			{ id: unfinishedId }
		)
	)
	await fixture.seed((db) =>
		db.insert(app.simplefinSyncAttempts, values(otherConnectionId), { id: otherAttemptId })
	)
}, 30_000)
afterAll(async () => {
	await fixture?.shutdown()
})
it('keeps the 100 boundary, rejects nonowner/unfinished deletion, and allows authorized admin reads', async () => {
	expect(await run()).toEqual({ kind: 'unchanged', deletedCount: 0, settlement: 'notStarted' })
	await expect(
		admin.expectDenied((db) => db.delete(app.simplefinSyncAttempts, attemptId(1)))
	).resolves.toBeUndefined()
	await expect(
		admin.expectDenied((db) => db.delete(app.simplefinSyncAccountResults, resultId))
	).resolves.toBeUndefined()
	await expect(
		owner.expectDenied((db) => db.delete(app.simplefinSyncAttempts, unfinishedId))
	).resolves.toBeUndefined()
	expect(await run(admin, fixture.accountFor(adminSession))).toMatchObject({
		kind: 'deferred',
		deletedCount: 0
	})
	expect(
		await admin.all(app.simplefinSyncAttempts.where({ connectionId }), { tier: 'remote' })
	).toHaveLength(101)
})
it('atomically deletes the oldest completed attempt and children at 101, preserving ties, unfinished rows and other connections', async () => {
	await fixture.seed((db) => db.insert(app.simplefinSyncAttempts, values(), { id: attemptId(101) }))
	expect(await run()).toEqual({ kind: 'cleaned', deletedCount: 1, settlement: 'confirmed' })
	const rows = await owner.all(app.simplefinSyncAttempts.where({ connectionId }), {
		tier: 'remote'
	})
	expect(rows).toHaveLength(101)
	expect(rows.some((row) => row.id === unfinishedId)).toBe(true)
	expect(rows.some((row) => row.id === attemptId(1))).toBe(false)
	expect(rows.some((row) => row.id === attemptId(2))).toBe(true)
	expect(
		await owner.one(app.simplefinSyncAccountResults.where({ id: resultId }), { tier: 'remote' })
	).toBeNull()
	expect(
		await owner.one(app.simplefinSyncAttempts.where({ id: otherAttemptId }), { tier: 'remote' })
	).not.toBeNull()
}, 15_000)
it('concurrent cleanup converges to exactly 100 completed entries without deleting unfinished history', async () => {
	await Promise.all(
		[102, 103].map((index) =>
			fixture.seed((db) => db.insert(app.simplefinSyncAttempts, values(), { id: attemptId(index) }))
		)
	)
	await Promise.all([run(), run()])
	await run()
	const rows = await owner.all(app.simplefinSyncAttempts.where({ connectionId }), {
		tier: 'remote'
	})
	expect(rows.filter((row) => row.outcome !== 'unfinished')).toHaveLength(100)
	expect(rows.filter((row) => row.outcome === 'unfinished')).toHaveLength(1)
	expect(rows.some((row) => row.id === attemptId(103))).toBe(true)
	expect(rows.some((row) => row.id === attemptId(4))).toBe(true)
}, 20_000)
