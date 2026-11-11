import { afterAll, beforeAll, expect, it } from 'vitest'
import { createPolicyTestApp, type PolicyTestApp, type PolicyTestSession } from 'jazz-tools/testing'
import { app } from '../../schema.js'
import permissions from '../../permissions.js'
import { fakeDataSetup } from './fake-data.js'
import { createActor, toPromise } from 'xstate'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
}, 30_000)
afterAll(async () => {
	await fixture?.shutdown()
})

async function scope(name: string) {
	const session = { user_id: name, authMode: 'local-first', claims: {} } satisfies PolicyTestSession
	const db = fixture.as(session)
	const userId = fixture.accountFor(session)
	const organizationId = crypto.randomUUID()
	await fixture.seed((seed) =>
		seed.insert(
			app.organizations,
			{
				name: 'Fake-data policy fixture',
				ownerId: userId,
				kind: 'personal',
				defaultCurrency: 'USD'
			},
			{ id: organizationId }
		)
	)
	await fixture.seed((seed) =>
		seed.insert(app.organizationMembers, {
			organizationId,
			userId,
			role: 'owner',
			accountAccessMode: 'all'
		})
	)
	for (const kind of ['income', 'expense'] satisfies ('income' | 'expense')[]) {
		await fixture.seed((seed) =>
			seed.insert(app.categories, { organizationId, kind, name: kind, isSystem: true })
		)
	}

	return { db, userId, organizationId }
}

it('seeds through the full app policy and skips subsequent starts without duplicating rows', async () => {
	const input = await scope('fake-data-owner')
	const result = await toPromise(createActor(fakeDataSetup, { input }).start())
	expect(result).toEqual({
		outcome: 'seeded',
		settlement: 'confirmed',
		accountCount: 3,
		transactionCount: 120
	})
	const before = await input.db.all(app.transactions.orderBy('id'), { tier: 'remote' })
	expect(before).toHaveLength(120)
	expect(await toPromise(createActor(fakeDataSetup, { input }).start())).toEqual({
		outcome: 'skipped',
		settlement: 'notStarted'
	})
	expect(
		(await input.db.all(app.transactions.orderBy('id'), { tier: 'remote' })).map((row) => row.id)
	).toEqual(before.map((row) => row.id))
	expect(await input.db.all(app.accounts, { tier: 'remote' })).toHaveLength(3)
}, 30_000)

it('concurrent seed attempts cannot create more than one batch', async () => {
	const input = await scope('fake-data-concurrent')
	const results = await Promise.all([
		toPromise(createActor(fakeDataSetup, { input }).start()),
		toPromise(createActor(fakeDataSetup, { input }).start())
	])
	expect(results.some((result) => result.outcome === 'seeded')).toBe(true)
	expect(await input.db.all(app.accounts, { tier: 'remote' })).toHaveLength(3)
	expect(await input.db.all(app.transactions, { tier: 'remote' })).toHaveLength(120)
}, 30_000)
