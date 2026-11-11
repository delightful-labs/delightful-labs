import { afterAll, beforeAll, expect, it } from 'vitest'
import {
	createPolicyTestApp,
	type PolicyTestApp,
	type PolicyTestSession,
	type TestDb
} from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createSyncLogMachine } from './machines/bank-sync/sync-log.js'
import {
	createActor,
	setup,
	types,
	type ActorRefFrom,
	createCallbackLogic,
	toPromise,
	waitFor
} from 'xstate'

const ownerSession = {
	user_id: 'sync-log-owner',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const adminSession = {
	user_id: 'sync-log-admin',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const viewerSession = {
	user_id: 'sync-log-viewer',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const organizationId = crypto.randomUUID(),
	connectionId = crypto.randomUUID(),
	accountId = crypto.randomUUID()
let fixture: PolicyTestApp
let owner: TestDb, admin: TestDb, viewer: TestDb
let initiatedBy: string
const startedAt = new Date('2026-10-30T12:00:00Z')
const attempt = () =>
	({
		organizationId,
		connectionId,
		initiatedBy,
		startedAt,
		outcome: 'unfinished',
		importSettlement: 'notStarted'
	}) satisfies import('jazz-tools').schema.InsertOf<typeof app.simplefinSyncAttempts>
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	owner = fixture.as(ownerSession)
	admin = fixture.as(adminSession)
	viewer = fixture.as(viewerSession)
	initiatedBy = fixture.accountFor(ownerSession)
	await fixture.seed((seed) =>
		seed.insert(
			app.organizations,
			{ name: 'Sync logs', ownerId: initiatedBy, kind: 'personal', defaultCurrency: 'USD' },
			{ id: organizationId }
		)
	)
	for (const [session, role] of [
		[ownerSession, 'owner'],
		[adminSession, 'admin'],
		[viewerSession, 'viewer']
	] satisfies [PolicyTestSession, 'owner' | 'admin' | 'viewer'][]) {
		await fixture.seed((seed) =>
			seed.insert(app.organizationMembers, {
				organizationId,
				userId: fixture.accountFor(session),
				role,
				accountAccessMode: 'all'
			})
		)
	}
	await fixture.seed((seed) =>
		seed.insert(
			app.simplefinConnections,
			{
				organizationId,
				ownerId: initiatedBy,
				accessUrl: '',
				status: 'active',
				claimedAt: startedAt
			},
			{ id: connectionId }
		)
	)
	await fixture.seed((seed) =>
		seed.insert(
			app.accounts,
			{ organizationId, name: 'Checking', kind: 'bank', currency: 'USD' },
			{ id: accountId }
		)
	)
}, 30000)
afterAll(async () => {
	await fixture?.shutdown()
})

it('persists account results through the logging actor before finalizing its attempt', async () => {
	const attemptId = crypto.randomUUID()
	const logic = createSyncLogMachine({ db: owner })
	const parent = createActor(
		setup({
			actors: { log: logic },
			schemas: { children: { log: types<ActorRefFrom<typeof logic>>() } }
		}).createMachine({
			invoke: {
				id: 'log',
				src: 'log',
				input: { id: attemptId, organizationId, connectionId, initiatedBy, startedAt }
			}
		})
	).start()
	const actor = parent.getSnapshot().children.log
	if (!actor) throw new Error('Missing supervised sync log')

	try {
		await waitFor(actor, (state) => state.matches('awaitingResult'))
		actor.send({
			type: 'FINISH',
			result: {
				outcome: 'succeeded',
				finishedAt: new Date('2026-10-30T12:01:00Z'),
				importSettlement: 'locallyPersisted',
				failureCode: null,
				importedCount: 2,
				existingCount: 0,
				omittedCount: 0
			},
			accounts: [
				{
					accountId,
					accountName: 'Checking',
					outcome: 'succeeded',
					failureCode: null,
					importedCount: 2,
					existingCount: 0,
					omittedCount: 0
				}
			]
		})
		expect(await toPromise(actor)).toMatchObject({ kind: 'recorded' })
		expect((await owner.one(app.simplefinSyncAttempts.where({ id: attemptId })))?.outcome).toBe(
			'succeeded'
		)
		const rows = await owner.all(app.simplefinSyncAccountResults.where({ attemptId }))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ accountId, accountName: 'Checking', importedCount: 2 })
	} finally {
		parent.stop()
	}
})

it('allows the owner to record and settle an attempt and account result, with admin reads', async () => {
	const row = await owner.insert(app.simplefinSyncAttempts, attempt()).wait({ tier: 'global' })
	const result = await owner
		.insert(app.simplefinSyncAccountResults, {
			attemptId: row.id,
			organizationId,
			accountId,
			accountName: 'Checking',
			outcome: 'succeeded',
			importedCount: 2,
			existingCount: 0,
			omittedCount: 0
		})
		.wait({ tier: 'global' })
	await owner
		.update(app.simplefinSyncAttempts, row.id, {
			outcome: 'succeeded',
			finishedAt: new Date('2026-10-30T12:01:00Z'),
			importSettlement: 'locallyPersisted',
			importedCount: 2,
			existingCount: 0,
			omittedCount: 0
		})
		.wait({ tier: 'global' })
	expect(
		(await admin.one(app.simplefinSyncAttempts.where({ id: row.id }), { tier: 'remote' }))?.outcome
	).toBe('succeeded')
	expect(
		(await admin.one(app.simplefinSyncAccountResults.where({ id: result.id }), { tier: 'remote' }))
			?.importedCount
	).toBe(2)
	await expect(
		owner.expectDenied((db) =>
			db.update(app.simplefinSyncAttempts, row.id, { outcome: 'unfinished' })
		)
	).resolves.toBeUndefined()
	await expect(
		owner.expectDenied((db) =>
			db.update(app.simplefinSyncAccountResults, result.id, { importedCount: 99 })
		)
	).resolves.toBeUndefined()
})
it('denies nonowner writes, viewer reads, forged scope, terminal inserts and deletes', async () => {
	const row = await owner.insert(app.simplefinSyncAttempts, attempt()).wait({ tier: 'global' })
	expect(
		await viewer.one(app.simplefinSyncAttempts.where({ id: row.id }), { tier: 'remote' })
	).toBeNull()
	await expect(
		admin.expectDenied((db) =>
			db.insert(app.simplefinSyncAttempts, {
				...attempt(),
				initiatedBy: fixture.accountFor(adminSession)
			})
		)
	).resolves.toBeUndefined()
	await expect(
		owner.expectDenied((db) =>
			db.insert(app.simplefinSyncAttempts, { ...attempt(), organizationId: crypto.randomUUID() })
		)
	).resolves.toBeUndefined()
	await expect(
		owner.expectDenied((db) =>
			db.insert(app.simplefinSyncAttempts, { ...attempt(), outcome: 'succeeded' })
		)
	).resolves.toBeUndefined()
	await expect(
		owner.expectDenied((db) =>
			db.update(app.simplefinSyncAttempts, row.id, { startedAt: new Date() })
		)
	).resolves.toBeUndefined()
	await expect(
		owner.expectDenied((db) => db.delete(app.simplefinSyncAttempts, row.id))
	).resolves.toBeUndefined()
})
