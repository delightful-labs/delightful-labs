import { describe, expect, it, vi } from 'vitest'
import { workspaceCreationReconciliation } from './workspace-creation-reconciliation.js'
import { attempt, profileId, userId, workspace } from './workspace-creation.fixture.js'
import { createActor, toPromise } from 'xstate'

const profile = { id: profileId, userId }
const member = {
	id: attempt.membershipId,
	organizationId: attempt.organizationId,
	userId,
	profileId,
	role: 'owner',
	accountAccessMode: 'all'
}
const categories = attempt.categories.map((row) => ({
	...row,
	organizationId: attempt.organizationId,
	archivedAt: null
}))
async function reconcile(
	rows: {
		profiles?: unknown[]
		organizations?: unknown[]
		memberships?: unknown[]
		categories?: unknown[]
	} = {}
) {
	const all = vi
		.fn()
		.mockResolvedValueOnce(rows.profiles ?? [profile])
		.mockResolvedValueOnce(rows.organizations ?? [workspace])
		.mockResolvedValueOnce(rows.memberships ?? [member])
		.mockResolvedValueOnce(rows.categories ?? categories)
	return toPromise(
		createActor(workspaceCreationReconciliation, { input: { db: { all }, attempt } }).start()
	)
}
describe('workspace creation reconciliation', () => {
	it('recognizes the original locally persisted attempt', async () => {
		expect(await reconcile()).toEqual({ outcome: 'matching', workspace })
	})
	it('allows later workspace/category edits and removal of optional starter rows', async () => {
		const renamed = { ...workspace, name: 'Renamed' }
		expect(
			await reconcile({
				organizations: [renamed],
				categories: categories.map((row) => ({ ...row, name: 'Edited' }))
			})
		).toEqual({ outcome: 'matching', workspace: renamed })
	})
	it('distinguishes an absent attempt from missing identity', async () => {
		expect(await reconcile({ organizations: [], memberships: [], categories: [] })).toEqual({
			outcome: 'absent'
		})
		expect(await reconcile({ profiles: [] })).toEqual({ outcome: 'profileUnavailable' })
	})
	it('does not treat a partial record set as absent or complete', async () => {
		expect(await reconcile({ memberships: [] })).toEqual({ outcome: 'conflict' })
		expect(await reconcile({ categories: categories.slice(0, 1) })).toEqual({ outcome: 'conflict' })
	})
	it('rejects stale or differently scoped identity and authorization records', async () => {
		expect(await reconcile({ profiles: [{ ...profile, userId: 'other' }] })).toEqual({
			outcome: 'profileUnavailable'
		})
		expect(await reconcile({ memberships: [{ ...member, role: 'member' }] })).toEqual({
			outcome: 'conflict'
		})
		expect(await reconcile({ memberships: [{ ...member, organizationId: 'other' }] })).toEqual({
			outcome: 'conflict'
		})
	})
	it('rejects archived required categories without mutating the workspace', async () => {
		expect(
			await reconcile({
				categories: categories.map((row) => ({ ...row, archivedAt: '2026-10-21' }))
			})
		).toEqual({ outcome: 'conflict' })
	})
})
