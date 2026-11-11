import { describe, expect, it } from 'vitest'
import { app } from '../../schema.js'
import {
	brokenRecords,
	integrityFixture,
	membership,
	records,
	scope
} from './workspace-integrity.fixture.js'
import { waitFor } from 'xstate'

describe('workspace integrity transaction ownership', () => {
	it('stages only the existing membership link in one local commit', async () => {
		const f = integrityFixture()
		const actor = f.transaction()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'complete', settlement: 'locallyPersisted' })
		expect(f.beginTransaction).toHaveBeenCalledTimes(1)
		expect(f.update).toHaveBeenCalledExactlyOnceWith(app.organizationMembers, membership.id, {
			profileId: scope.profileId
		})
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).toHaveBeenCalledTimes(1)
		expect(f.wait).toHaveBeenCalledWith({ tier: 'local' })
		expect(f.rollback).not.toHaveBeenCalled()
		expect(done.context.tx).toBeUndefined()
	})
	it('rolls back a no-op if another operation already repaired the records', async () => {
		const f = integrityFixture(brokenRecords(), brokenRecords(), records())
		const done = await waitFor(f.transaction(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'complete', settlement: 'notStarted' })
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.update).not.toHaveBeenCalled()
	})
	it('does not recreate a membership that disappeared after authoritative discovery', async () => {
		const f = integrityFixture(brokenRecords(), brokenRecords(), records({ memberships: [] }))
		const done = await waitFor(f.transaction(), (s) => s.status === 'done')
		expect(done.output).toEqual({
			outcome: 'unavailable',
			reason: 'accessUnavailable',
			settlement: 'notStarted'
		})
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.update).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})
	it('does not write using lost role authority', async () => {
		const f = integrityFixture(
			brokenRecords(),
			brokenRecords(),
			records({ memberships: [{ ...membership, profileId: null, role: 'viewer' }] })
		)
		const done = await waitFor(f.transaction(), (s) => s.status === 'done')
		expect(done.output).toEqual({
			outcome: 'partial',
			settlement: 'notStarted',
			issues: ['profileLink']
		})
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.update).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('rejects a transaction repair that differs from the confirmed profile link', async () => {
		const f = integrityFixture()
		const done = await waitFor(
			f.transaction({ profileLink: { membershipId: scope.profileId, profileId: scope.profileId } }),
			(s) => s.status === 'done'
		)
		expect(done.output).toEqual({
			outcome: 'conflict',
			reason: 'repairPlanChanged',
			settlement: 'notStarted'
		})
		expect(f.update).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})
	it('cancels during acquisition, rolls back the acquired resource, and does not read', async () => {
		const f = integrityFixture()
		const actor = f.transaction()
		actor.send({ type: 'CANCEL' })
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.all).not.toHaveBeenCalled()
	})
	it('drains an outstanding read before releasing its transaction on shutdown', async () => {
		const f = integrityFixture()
		const pending = Promise.withResolvers<ReturnType<typeof records>['profiles']>()
		f.all.mockReset().mockResolvedValue([]).mockReturnValueOnce(pending.promise)
		const actor = f.transaction()
		await waitFor(actor, (s) => s.matches({ running: { work: 'reading' } }))
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.rollback).not.toHaveBeenCalled()
		pending.resolve(records().profiles)
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'notStarted' })
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('waits for staging before rollback and preserves shutdown over cancellation', async () => {
		const f = integrityFixture()
		const pending = Promise.withResolvers<void>()
		f.update.mockImplementation(() => pending.promise)
		const actor = f.transaction()
		await waitFor(actor, (s) => s.matches({ running: { work: 'stagingProfileLink' } }))
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(f.rollback).not.toHaveBeenCalled()
		pending.resolve()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'notStarted' })
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledTimes(1)
	})
	it('drains an issued commit and reports actual persistence even after shutdown', async () => {
		const f = integrityFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => pending.promise)
		const actor = f.transaction()
		await waitFor(actor, (s) => s.matches({ running: { work: 'settling' } }))
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.rollback).not.toHaveBeenCalled()
		pending.resolve()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'locallyPersisted' })
		expect(f.rollback).not.toHaveBeenCalled()
	})
	it('rolls back staged writes on profile-link update failure', async () => {
		const f = integrityFixture()
		const error = new Error('staging failed')
		f.update.mockImplementation(() => {
			throw error
		})
		const done = await waitFor(f.transaction(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'notStarted', error })
		expect(f.rollback).toHaveBeenCalledTimes(1)
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('reports failed acquisition without attempting cleanup on a nonexistent transaction', async () => {
		const f = integrityFixture()
		const error = new Error('open failed')
		f.beginTransaction.mockImplementation(() => {
			throw error
		})
		const done = await waitFor(f.transaction(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'notStarted', error })
		expect(f.rollback).not.toHaveBeenCalled()
	})
	it('keeps settlement failures unresolved without trying to undo an issued commit', async () => {
		const f = integrityFixture()
		const error = new Error('settlement unknown')
		f.wait.mockRejectedValue(error)
		const done = await waitFor(f.transaction(), (s) => s.status === 'done')
		expect(done.value).toBe('unresolved')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'unresolved', error })
		expect(f.rollback).not.toHaveBeenCalled()
	})
	for (const rollbackFails of ['false', 'reject']) {
		it(`reports unresolved cleanup when rollback returns ${rollbackFails}`, async () => {
			const f = integrityFixture()
			if (rollbackFails === 'false') f.rollback.mockResolvedValue(false)
			else f.rollback.mockRejectedValue(new Error('rollback failed'))
			const actor = f.transaction()
			actor.send({ type: 'CANCEL' })
			const done = await waitFor(actor, (s) => s.status === 'done')
			expect(done.output).toMatchObject({ outcome: 'cancelled', settlement: 'unresolved' })
			expect(f.commit).not.toHaveBeenCalled()
		})
	}
})
