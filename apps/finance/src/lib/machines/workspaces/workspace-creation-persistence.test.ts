import { describe, expect, it } from 'vitest'
import { ReadTier } from 'jazz-tools'
import {
	attempt,
	creationFixture,
	workspace,
	profileId,
	userId
} from './workspace-creation.fixture.js'
import { waitFor } from 'xstate'

describe('workspace persistence composition', () => {
	it('reconciles once before opening a transaction, then rechecks inside the transaction', async () => {
		const f = creationFixture()
		const hydrated = Promise.withResolvers<unknown[]>()
		f.hydrate.mockReset().mockResolvedValue([]).mockReturnValueOnce(hydrated.promise)
		const actor = f.persistence()
		await waitFor(actor, (s) => s.matches('reconciling'))
		expect(f.beginTransaction).not.toHaveBeenCalled()
		expect(f.hydrate).toHaveBeenCalledTimes(4)
		expect(f.hydrate.mock.calls.every((call) => call[1]?.tier === ReadTier.LocalFirst)).toBe(true)
		hydrated.resolve([{ id: profileId, userId }])
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'succeeded', settlement: 'locallyPersisted', workspace })
		expect(f.hydrate).toHaveBeenCalledTimes(4)
		expect(f.one).toHaveBeenCalledTimes(3)
		expect(f.all).toHaveBeenCalledTimes(1)
	})
	it('rejects blank names before reading or opening resources', async () => {
		const f = creationFixture()
		const done = await waitFor(
			f.persistence({ ...attempt, workspace: { ...attempt.workspace, name: ' ' } }),
			(s) => s.status === 'done'
		)
		expect(done.output).toMatchObject({ outcome: 'failed', settlement: 'notStarted' })
		expect(f.hydrate).not.toHaveBeenCalled()
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('does not start creation from failed reconciliation', async () => {
		const f = creationFixture()
		const error = new Error('read failed')
		f.hydrate.mockReset().mockRejectedValue(error)
		const done = await waitFor(f.persistence(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'notStarted', error })
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('ignores late reconciliation after cancellation', async () => {
		const f = creationFixture()
		const hydrated = Promise.withResolvers<unknown[]>()
		f.hydrate.mockReset().mockResolvedValue([]).mockReturnValueOnce(hydrated.promise)
		const actor = f.persistence()
		await waitFor(actor, (s) => s.matches('reconciling'))
		actor.send({ type: 'CANCEL' })
		hydrated.resolve([{ id: profileId, userId }])
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('returns an already persisted attempt without opening or repeating writes', async () => {
		const f = creationFixture()
		f.hydrate
			.mockReset()
			.mockResolvedValueOnce([{ id: profileId, userId }])
			.mockResolvedValueOnce([workspace])
			.mockResolvedValueOnce([
				{
					id: attempt.membershipId,
					organizationId: attempt.organizationId,
					userId,
					profileId,
					role: 'owner',
					accountAccessMode: 'all'
				}
			])
			.mockResolvedValueOnce(
				attempt.categories.map((row) => ({ ...row, organizationId: attempt.organizationId }))
			)
		const done = await waitFor(f.persistence(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'succeeded', settlement: 'locallyPersisted', workspace })
		expect(f.hydrate).toHaveBeenCalledTimes(4)
		expect(f.beginTransaction).not.toHaveBeenCalled()
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it.each([
		{ outcome: 'profileUnavailable', profiles: [], organizations: [] },
		{ outcome: 'conflict', profiles: [{ id: profileId, userId }], organizations: [workspace] }
	])(
		'returns $outcome before acquiring write resources',
		async ({ outcome, profiles, organizations }) => {
			const f = creationFixture()
			f.hydrate
				.mockReset()
				.mockResolvedValue([])
				.mockResolvedValueOnce(profiles)
				.mockResolvedValueOnce(organizations)
			const done = await waitFor(f.persistence(), (s) => s.status === 'done')
			expect(done.output).toEqual({ outcome, settlement: 'notStarted' })
			expect(f.beginTransaction).not.toHaveBeenCalled()
			expect(f.insert).not.toHaveBeenCalled()
		}
	)
	it('rejects a profile lost between reconciliation and the transaction', async () => {
		const f = creationFixture()
		f.one.mockReset().mockResolvedValue(null)
		const done = await waitFor(f.persistence(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'profileUnavailable', settlement: 'notStarted' })
		expect(f.beginTransaction).toHaveBeenCalledTimes(1)
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('forwards shutdown to the child and waits for local persistence', async () => {
		const f = creationFixture()
		const pending = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => {
			started.resolve()
			return pending.promise
		})
		const actor = f.persistence()
		await started.promise
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		pending.resolve()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'locallyPersisted' })
	})
})
