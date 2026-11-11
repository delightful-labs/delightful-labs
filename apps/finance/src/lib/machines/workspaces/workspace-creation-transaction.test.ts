import { describe, expect, it, vi } from 'vitest'
import { app } from '../../schema.js'
import { creationFixture, attempt, workspace } from './workspace-creation.fixture.js'
import { waitFor } from 'xstate'

describe.each(['native', 'shared'])('%s workspace transaction ownership', (owner) => {
	const transaction = (f: ReturnType<typeof creationFixture>) =>
		owner === 'native' ? f.transaction() : f.additionalTransaction()
	it('stages one complete workspace and reports success only after local persistence', async () => {
		const f = creationFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockReturnValue(pending.promise)
		const actor = transaction(f)
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalledTimes(1))
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.beginTransaction).toHaveBeenCalledTimes(1)
		expect(f.insert).toHaveBeenCalledTimes(4)
		expect(f.insert).toHaveBeenNthCalledWith(1, app.organizations, attempt.workspace, {
			id: attempt.organizationId
		})
		expect(f.insert).toHaveBeenNthCalledWith(
			2,
			app.organizationMembers,
			{
				organizationId: attempt.organizationId,
				userId: attempt.workspace.ownerId,
				profileId: attempt.profileId,
				role: 'owner',
				accountAccessMode: 'all'
			},
			{ id: attempt.membershipId }
		)
		expect(f.wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
		if (owner === 'shared') {
			expect(f.one.mock.calls.every((call) => call[1]?.tier === 'local-first')).toBe(true)
			expect(f.all.mock.calls.every((call) => call[1]?.tier === 'local-first')).toBe(true)
		}
		pending.resolve()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'succeeded', settlement: 'locallyPersisted', workspace })
		expect(f.rollback).not.toHaveBeenCalled()
	})
	it('rolls back a missing profile before staging records', async () => {
		const f = creationFixture()
		f.one.mockReset().mockResolvedValue(null)
		const done = await waitFor(transaction(f), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'profileUnavailable', settlement: 'notStarted' })
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it.each(['organization', 'membership', 'categories'])(
		'does not overwrite an occupied attempt (%s)',
		async (occupied) => {
			const f = creationFixture()
			if (occupied === 'organization') f.one.mockResolvedValueOnce(workspace)
			if (occupied === 'membership')
				f.one.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: attempt.membershipId })
			if (occupied === 'categories')
				f.all.mockResolvedValueOnce([{ id: attempt.categories[0]?.id }])
			const done = await waitFor(transaction(f), (s) => s.status === 'done')
			expect(done.output).toEqual({ outcome: 'conflict', settlement: 'notStarted' })
			expect(f.rollback).toHaveBeenCalledTimes(1)
			expect(f.insert).not.toHaveBeenCalled()
		}
	)
	it('owns a newly acquired transaction when shutdown races opening', async () => {
		const f = creationFixture()
		const actor = transaction(f)
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'notStarted' })
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.one).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('drains a read then rolls back on cancellation, ignoring late read completion', async () => {
		const f = creationFixture()
		const read = Promise.withResolvers<null>()
		f.one.mockReset().mockReturnValue(read.promise)
		const actor = transaction(f)
		await vi.waitFor(() => expect(f.one).toHaveBeenCalled())
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		read.resolve(null)
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.insert).not.toHaveBeenCalled()
	})
	it('rolls back staged rows if insertion fails', async () => {
		const f = creationFixture()
		const error = new Error('membership write failed')
		f.insert
			.mockImplementationOnce(() => workspace)
			.mockImplementationOnce(() => {
				throw error
			})
		const done = await waitFor(transaction(f), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'notStarted', error })
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('rolls back staged data when cancellation arrives before commit', async () => {
		const f = creationFixture()
		const actor = transaction(f)
		f.insert.mockImplementationOnce(() => {
			actor.send({ type: 'CANCEL' })
			return workspace
		})
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('reports acquisition errors without attempting cleanup of an unowned resource', async () => {
		const f = creationFixture()
		const error = new Error('transaction unavailable')
		f.beginTransaction.mockImplementation(() => {
			throw error
		})
		const done = await waitFor(transaction(f), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'notStarted', error })
		expect(f.rollback).not.toHaveBeenCalled()
		expect(f.insert).not.toHaveBeenCalled()
	})
	it('waits for issued commit settlement and preserves shutdown over cancellation', async () => {
		const f = creationFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockReturnValue(pending.promise)
		const actor = transaction(f)
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalledTimes(1))
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.rollback).not.toHaveBeenCalled()
		pending.resolve()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'locallyPersisted' })
		expect(f.commit).toHaveBeenCalledTimes(1)
	})
	it('reports unconfirmed rollback as unresolved instead of claiming nothing happened', async () => {
		const f = creationFixture()
		f.one.mockReset().mockResolvedValue(null)
		f.rollback.mockResolvedValue(false)
		const done = await waitFor(transaction(f), (s) => s.status === 'done')
		expect(done.output).toMatchObject({ outcome: 'failed', settlement: 'unresolved' })
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('does not claim a rejected local wait was undone even after cleanup', async () => {
		const f = creationFixture()
		const error = new Error('local persistence failed')
		f.wait.mockRejectedValue(error)
		const done = await waitFor(transaction(f), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'unresolved', error })
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})
})
