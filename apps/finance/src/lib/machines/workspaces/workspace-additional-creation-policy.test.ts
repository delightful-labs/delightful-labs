import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPolicyTestApp, type PolicyTestApp, type TestDb } from 'jazz-tools/testing'
import { app } from '../../schema.js'
import permissions from '../../permissions.js'
import { prepareWorkspaceCreation } from '../../domain/workspace-creation.js'
import { createAdditionalWorkspaceTransaction } from './workspace-additional-creation-transaction.js'
import { createActor, toPromise } from 'xstate'

const ownerSession = {
	user_id: 'private-creation-owner',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
const otherSession = {
	user_id: 'private-creation-other',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
const profileId = crypto.randomUUID()
let fixture: PolicyTestApp
let db: TestDb
let other: TestDb
let userId: string
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	db = fixture.as(ownerSession)
	other = fixture.as(otherSession)
	userId = fixture.accountFor(ownerSession)
	const otherId = fixture.accountFor(otherSession)
	const sharedId = crypto.randomUUID()
	await fixture.seed((seed) =>
		seed.insert(app.profiles, { userId, initialWorkspaceId: null }, { id: profileId })
	)
	await fixture.seed((seed) =>
		seed.insert(
			app.organizations,
			{ name: 'Shared fixture', kind: 'personal', defaultCurrency: 'USD', ownerId: userId },
			{ id: sharedId }
		)
	)
	for (const memberId of [userId, otherId])
		await fixture.seed((seed) =>
			seed.insert(app.organizationMembers, {
				organizationId: sharedId,
				userId: memberId,
				role: memberId === userId ? 'owner' : 'member',
				accountAccessMode: 'all',
				...(memberId === userId ? { profileId } : {})
			})
		)
}, 30_000)
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
	await fixture?.shutdown()
})
async function attempt(name = 'Private workspace') {
	return prepareWorkspaceCreation({ organizationId: crypto.randomUUID(), userId, profileId, name })
}
function capture(database: TestDb) {
	const resource = database.beginTransaction()
	vi.spyOn(database, 'beginTransaction').mockReturnValue(resource)
	return vi.spyOn(resource, 'commit')
}
async function create(database: TestDb, draft: Awaited<ReturnType<typeof attempt>>) {
	const actor = createActor(createAdditionalWorkspaceTransaction(database), {
		input: { attempt: draft }
	}).start()
	try {
		return await toPromise(actor)
	} finally {
		actor.stop()
	}
}

describe('additional workspace adapter with the full Finance policy', () => {
	it('globally accepts the atomic workspace, owner membership and every starter category, while keeping it private', async () => {
		const draft = await attempt()
		const commit = capture(db)
		expect(await create(db, draft)).toMatchObject({
			outcome: 'succeeded',
			settlement: 'locallyPersisted',
			workspace: { id: draft.organizationId }
		})
		const write = commit.mock.results[0]
		if (write?.type !== 'return') throw new Error('Expected issued workspace commit')
		await write.value.wait({ tier: 'global' })
		expect(
			await db.one(app.organizations.where({ id: draft.organizationId }), { tier: 'remote' })
		).toMatchObject(draft.workspace)
		expect(
			await db.one(app.organizationMembers.where({ id: draft.membershipId }), { tier: 'remote' })
		).toMatchObject({
			organizationId: draft.organizationId,
			userId,
			profileId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		const categories = await db.all(
			app.categories.where({ organizationId: draft.organizationId }),
			{ tier: 'remote' }
		)
		expect(categories).toHaveLength(draft.categories.length)
		for (const category of draft.categories)
			expect(categories).toContainEqual(
				expect.objectContaining({ ...category, organizationId: draft.organizationId })
			)
		expect(
			await other.one(app.organizations.where({ id: draft.organizationId }), { tier: 'remote' })
		).toBeNull()
		expect(
			await other.all(app.categories.where({ organizationId: draft.organizationId }), {
				tier: 'remote'
			})
		).toEqual([])
	})
	it('rejects creating a private workspace for another identity even when its profile is readable', async () => {
		const draft = await attempt('Forged owner')
		expect(
			await other.one(app.profiles.where({ id: profileId }), { tier: 'remote' })
		).not.toBeNull()
		const commit = capture(other)
		await create(other, draft)
		const write = commit.mock.results[0]
		if (write?.type !== 'return') throw new Error('Expected authority-qualified workspace commit')
		await expect(write.value.wait({ tier: 'global' })).rejects.toThrow(
			/permission_denied|AuthorizationDenied|Write rejected by server authorization/
		)
		expect(
			await db.one(app.organizations.where({ id: draft.organizationId }), { tier: 'remote' })
		).toBeNull()
		expect(
			await db.one(app.organizationMembers.where({ id: draft.membershipId }), { tier: 'remote' })
		).toBeNull()
		expect(
			await db.all(app.categories.where({ organizationId: draft.organizationId }), {
				tier: 'remote'
			})
		).toEqual([])
	})
	it('treats an unreadable profile as unavailable without committing a replacement', async () => {
		const draft = await attempt()
		const commit = capture(db)
		expect(await create(db, { ...draft, profileId: crypto.randomUUID() })).toEqual({
			outcome: 'profileUnavailable',
			settlement: 'notStarted'
		})
		expect(commit).not.toHaveBeenCalled()
		expect(
			await db.one(app.organizations.where({ id: draft.organizationId }), { tier: 'remote' })
		).toBeNull()
	})
})
