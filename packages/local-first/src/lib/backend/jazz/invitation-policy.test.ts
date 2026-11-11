import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPolicyTestApp, type PolicyTestApp, type PolicyTestSession } from 'jazz-tools/testing'
import {
	invitationApp as app,
	invitationPermissions
} from '../../../../tests/fixtures/invitations/schema.js'

const owner = {
	user_id: 'notebook-owner',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const member = {
	user_id: 'notebook-member',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const outsider = {
	user_id: 'notebook-outsider',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
let fixture: PolicyTestApp
const notebookId = crypto.randomUUID()
const invitationId = crypto.randomUUID()
const membershipId = crypto.randomUUID()
const evidenceId = crypto.randomUUID()
const privateInvitation = {
	notebookId,
	codeDigest: 'synthetic-private-digest',
	role: 'collaborator',
	expiresAt: null,
	revoked: false,
	consumedAccountId: null,
	consumedOperationId: null,
	consumedMembershipId: null
} satisfies import('jazz-tools').schema.InsertOf<typeof app.notebookInvitations>

beforeAll(async () => {
	fixture = await createPolicyTestApp(app, invitationPermissions, expect)
	await fixture
		.as(owner)
		.insert(app.notebooks, { name: 'Private notebook' }, { id: notebookId })
		.wait({ tier: 'global' })
	await fixture
		.as(owner)
		.insert(app.notebookMembers, {
			notebookId,
			accountId: fixture.accountFor(owner),
			role: 'collaborator',
			invitationId: null
		})
		.wait({ tier: 'global' })
	await fixture.seed((db) =>
		db.insert(
			app.notebookMembers,
			{
				notebookId,
				accountId: fixture.accountFor(member),
				role: 'collaborator',
				invitationId
			},
			{ id: membershipId }
		)
	)
	await fixture.seed((db) =>
		db.insert(app.notebookInvitations, privateInvitation, { id: invitationId })
	)
	await fixture.seed((db) =>
		db.insert(
			app.notebookRedemptions,
			{
				operationId: 'accepted-operation',
				invitationId,
				notebookId,
				accountId: fixture.accountFor(member),
				membershipId,
				acceptedAt: 5000
			},
			{ id: evidenceId }
		)
	)
}, 30000)
afterAll(async () => {
	await fixture?.shutdown()
})

describe('native invitation schema permissions', () => {
	it.each([owner, member])(
		'allows current membership notebook reads for $user_id',
		async (session) => {
			const db = fixture.as(session)
			expect(
				(await db.all(app.notebooks.where({ id: notebookId }), { tier: 'remote' })).map(
					(row) => row.id
				)
			).toEqual([notebookId])
			const members = await db.all(app.notebookMembers.where({ notebookId }), { tier: 'remote' })
			expect(members).toHaveLength(1)
			expect(members[0]?.accountId).toBe(fixture.accountFor(session))
		}
	)
	it('denies unrelated notebook and membership reads', async () => {
		const db = fixture.as(outsider)
		expect(await db.all(app.notebooks.where({ id: notebookId }), { tier: 'remote' })).toEqual([])
		expect(await db.all(app.notebookMembers.where({ notebookId }), { tier: 'remote' })).toEqual([])
	})
	it.each([owner, member, outsider])(
		'never exposes private invitations or evidence to $user_id',
		async (session) => {
			const db = fixture.as(session)
			expect(await db.all(app.notebookInvitations, { tier: 'remote' })).toEqual([])
			expect(await db.all(app.notebookRedemptions, { tier: 'remote' })).toEqual([])
		}
	)
	it.each([member, outsider])('rejects self-grants by noncreators: $user_id', async (session) => {
		await fixture.as(session).expectDenied((db) =>
			db.insert(app.notebookMembers, {
				notebookId,
				accountId: fixture.accountFor(session),
				role: 'collaborator',
				invitationId: null
			})
		)
	})
	it('rejects creator grants to another account', async () => {
		await fixture.as(owner).expectDenied((db) =>
			db.insert(app.notebookMembers, {
				notebookId,
				accountId: fixture.accountFor(outsider),
				role: 'collaborator',
				invitationId: null
			})
		)
	})
	it('rejects creator bootstrap with forged invitation attribution', async () => {
		await fixture.as(owner).expectDenied((db) =>
			db.insert(app.notebookMembers, {
				notebookId,
				accountId: fixture.accountFor(owner),
				role: 'collaborator',
				invitationId
			})
		)
	})
	it('rejects membership mutation and deletion of another member', async () => {
		await fixture
			.as(member)
			.expectDenied((db) => db.update(app.notebookMembers, membershipId, { invitationId: null }))
		await fixture.as(owner).expectDenied((db) => db.delete(app.notebookMembers, membershipId))
	})
	it.each([owner, member, outsider])(
		'rejects all private mutations by $user_id',
		async (session) => {
			const db = fixture.as(session)
			await db.expectDenied((scope) => scope.insert(app.notebookInvitations, privateInvitation))
			await expect(async () => {
				await db
					.update(app.notebookInvitations, invitationId, { revoked: true })
					.wait({ tier: 'global' })
			}).rejects.toMatchObject({ code: 'permission_denied' })
			await db.expectDenied((scope) => scope.delete(app.notebookInvitations, invitationId))
			await db.expectDenied((scope) =>
				scope.insert(app.notebookRedemptions, {
					operationId: 'forged',
					invitationId,
					notebookId,
					accountId: fixture.accountFor(session),
					membershipId,
					acceptedAt: 0
				})
			)
			await expect(async () => {
				await db
					.update(app.notebookRedemptions, evidenceId, { acceptedAt: 1 })
					.wait({ tier: 'global' })
			}).rejects.toMatchObject({ code: 'permission_denied' })
			await db.expectDenied((scope) => scope.delete(app.notebookRedemptions, evidenceId))
		}
	)
	it('allows leaving and denies subsequent notebook access', async () => {
		const db = fixture.as(member)
		await db.delete(app.notebookMembers, membershipId).wait({ tier: 'global' })
		expect(await db.all(app.notebooks.where({ id: notebookId }), { tier: 'remote' })).toEqual([])
	})
})
