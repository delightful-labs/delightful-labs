import { describe, expect, it } from 'vitest'
import { ReadTier } from 'jazz-tools'
import { app } from '../../schema.js'
import { stableUuid } from '../../domain/stable-uuid.js'
import {
	creationFixture,
	attempt,
	profileId,
	userId,
	workspace
} from './workspace-creation.fixture.js'
import { waitFor } from 'xstate'

const profile = {
	id: profileId,
	userId,
	initialWorkspaceId: null,
	displayName: 'Existing profile',
	avatarData: null,
	avatarMimeType: null
}

describe('workspace initialization decisions', () => {
	it('uses a warm initialization marker without recreating its now-inaccessible workspace', async () => {
		const f = creationFixture()
		const init = f.initialization()
		init.discover
			.mockResolvedValueOnce([{ ...profile, initialWorkspaceId: workspace.id }])
			.mockResolvedValueOnce([])
		const done = await waitFor(init.actor.start(), (s) => s.status === 'done')
		expect(done.output).toEqual({
			outcome: 'ready',
			identityId: profileId,
			workspaceId: workspace.id
		})
		expect(init.discover).toHaveBeenCalledTimes(2)
		expect(init.discover.mock.calls[0]?.[1]?.tier).toBe(ReadTier.LocalFirst)
		expect(f.beginTransaction).not.toHaveBeenCalled()
		expect(f.insert).not.toHaveBeenCalled()
	})
	it.each([
		{ organizations: [] },
		{
			organizations: [
				{ ...workspace, kind: 'business', ownerId: '77777777-7777-4777-8777-777777777777' }
			]
		}
	])(
		'reports a missing initialization marker without backfilling from accessible workspaces: %j',
		async ({ organizations }) => {
			const f = creationFixture()
			const init = f.initialization()
			init.discover
				.mockResolvedValueOnce([profile])
				.mockResolvedValueOnce(organizations)
				.mockResolvedValueOnce([profile])
				.mockResolvedValueOnce(organizations)
			const done = await waitFor(init.actor.start(), (s) => s.status === 'done')
			expect(done.output).toEqual({ outcome: 'unavailable', reason: 'initializationMissing' })
			expect(init.discover).toHaveBeenCalledTimes(4)
			expect(f.beginTransaction).not.toHaveBeenCalled()
			expect(f.update).not.toHaveBeenCalled()
			expect(f.insert).not.toHaveBeenCalled()
		}
	)
	it('requires confirmed remote emptiness before creating the initial profile and workspace', async () => {
		const f = creationFixture()
		const init = f.initialization()
		const remote = Promise.withResolvers<never[]>()
		init.discover
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockReturnValue(remote.promise)
		f.one.mockReset().mockResolvedValue(null)
		const actor = init.actor.start()
		await waitFor(actor, (s) => s.matches('awaitingAuthority'))
		expect(f.beginTransaction).not.toHaveBeenCalled()
		expect(
			init.discover.mock.calls.slice(2).every((call) => call[1]?.tier === ReadTier.Remote)
		).toBe(true)
		remote.resolve([])
		const done = await waitFor(actor, (s) => s.status === 'done')
		const expectedProfileId = await stableUuid(userId, 'profile')
		const expectedWorkspaceId = await stableUuid(userId, 'personal-organization')
		expect(done.output).toEqual({
			outcome: 'ready',
			identityId: expectedProfileId,
			workspaceId: expectedWorkspaceId
		})
		expect(f.insert).toHaveBeenNthCalledWith(
			1,
			app.profiles,
			{ userId, initialWorkspaceId: expectedWorkspaceId },
			{ id: expectedProfileId }
		)
		expect(f.insert).toHaveBeenCalledWith(
			app.organizationMembers,
			expect.objectContaining({
				userId,
				organizationId: expectedWorkspaceId,
				profileId: expectedProfileId,
				role: 'owner'
			}),
			{ id: await stableUuid(userId, 'personal-membership') }
		)
	})
	it('does not treat an unconfigured empty local database as permission to bootstrap', async () => {
		const f = creationFixture()
		const init = f.initialization()
		init.getConfig.mockReturnValue({})
		const done = await waitFor(init.actor.start(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'unavailable', reason: 'authorityUnavailable' })
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('uses remote initialization knowledge arriving after an empty local cache', async () => {
		const f = creationFixture()
		const init = f.initialization()
		init.discover
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ ...profile, initialWorkspaceId: workspace.id }])
			.mockResolvedValueOnce([])
		const done = await waitFor(init.actor.start(), (s) => s.status === 'done')
		expect(done.output).toEqual({
			outcome: 'ready',
			identityId: profileId,
			workspaceId: workspace.id
		})
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it.each([
		{
			profiles: [profile, { ...profile, id: userId }],
			organizations: [workspace],
			reason: 'duplicateIdentities'
		},
		{ profiles: [], organizations: [workspace], reason: 'identityMissing' }
	])(
		'reports $reason without inventing identity links',
		async ({ profiles, organizations, reason }) => {
			const f = creationFixture()
			const init = f.initialization()
			init.discover
				.mockResolvedValueOnce(profiles)
				.mockResolvedValueOnce(organizations)
				.mockResolvedValueOnce(profiles)
				.mockResolvedValueOnce(organizations)
			const done = await waitFor(init.actor.start(), (s) => s.status === 'done')
			expect(done.output).toEqual({ outcome: 'unavailable', reason })
			expect(f.beginTransaction).not.toHaveBeenCalled()
		}
	)
	it('does not create after cancellation of an outstanding remote read', async () => {
		const f = creationFixture()
		const init = f.initialization()
		const remote = Promise.withResolvers<never[]>()
		init.discover
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockReturnValue(remote.promise)
		const actor = init.actor.start()
		await waitFor(actor, (s) => s.matches('awaitingAuthority'))
		actor.send({ type: 'CANCEL' })
		remote.resolve([])
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('drains bootstrap persistence before completing shutdown', async () => {
		const f = creationFixture()
		const init = f.initialization()
		f.one.mockReset().mockResolvedValue(null)
		const pending = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => {
			started.resolve()
			return pending.promise
		})
		const actor = init.actor.start()
		await started.promise
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		pending.resolve()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'locallyPersisted' })
		expect(f.rollback).not.toHaveBeenCalled()
	})
	it('returns read failures without attempting bootstrap', async () => {
		const f = creationFixture()
		const init = f.initialization()
		const error = new Error('initialization query failed')
		init.discover.mockRejectedValue(error)
		const done = await waitFor(init.actor.start(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'notStarted', error })
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
})

describe('initialization transaction boundaries', () => {
	it('does not overwrite a profile that appeared before first-time bootstrap', async () => {
		const f = creationFixture()
		const done = await waitFor(f.transaction('bootstrap'), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'profileUnavailable', settlement: 'notStarted' })
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})
	it('rolls back the staged initial profile if workspace creation fails', async () => {
		const f = creationFixture()
		f.one.mockReset().mockResolvedValue(null)
		const error = new Error('workspace insert failed')
		f.insert
			.mockImplementationOnce(() => workspace)
			.mockImplementationOnce(() => {
				throw error
			})
		const done = await waitFor(f.transaction('bootstrap'), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'notStarted', error })
		expect(f.insert).toHaveBeenNthCalledWith(
			1,
			app.profiles,
			{ userId, initialWorkspaceId: attempt.organizationId },
			{ id: profileId }
		)
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.commit).not.toHaveBeenCalled()
	})
})
