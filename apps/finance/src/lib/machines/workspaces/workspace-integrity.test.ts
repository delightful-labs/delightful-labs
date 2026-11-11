import { describe, expect, it, vi } from 'vitest'
import { ReadTier } from 'jazz-tools'
import { workspaceIntegrity } from './workspace-integrity.js'
import {
	brokenRecords,
	integrityFixture,
	membership,
	records,
	scope
} from './workspace-integrity.fixture.js'
import { createActor, waitFor } from 'xstate'

describe('selected workspace integrity coordination', () => {
	it('accepts intact local records without reading remotely or opening a transaction', async () => {
		const f = integrityFixture(records())
		const done = await waitFor(f.coordinator(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'complete', settlement: 'notStarted' })
		expect(f.discover).toHaveBeenCalledTimes(3)
		for (const [, options] of f.discover.mock.calls)
			expect(options).toEqual({ tier: ReadTier.LocalFirst })
		expect(f.getConfig).not.toHaveBeenCalled()
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('confirms a suspected repair remotely before opening a transaction', async () => {
		const f = integrityFixture()
		const done = await waitFor(f.coordinator(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'complete', settlement: 'locallyPersisted' })
		expect(f.discover).toHaveBeenCalledTimes(6)
		for (const [, options] of f.discover.mock.calls.slice(3))
			expect(options).toEqual({ tier: ReadTier.Remote })
		expect(f.discover.mock.invocationCallOrder[5]).toBeLessThan(
			f.beginTransaction.mock.invocationCallOrder[0] ?? 0
		)
		expect(f.commit).toHaveBeenCalledTimes(1)
	})
	it('does not write when remote discovery shows the local snapshot was incomplete', async () => {
		const f = integrityFixture(brokenRecords(), records())
		const done = await waitFor(f.coordinator(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'complete', settlement: 'notStarted' })
		expect(f.discover).toHaveBeenCalledTimes(6)
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('reports partial integrity without guessing absence when no authority is configured', async () => {
		const f = integrityFixture()
		f.getConfig.mockReturnValue({})
		const done = await waitFor(f.coordinator(), (s) => s.status === 'done')
		expect(done.value).toBe('partial')
		expect(done.output).toEqual({
			outcome: 'partial',
			settlement: 'notStarted',
			issues: ['profileLink']
		})
		expect(f.discover).toHaveBeenCalledTimes(3)
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('does not attempt unauthorized viewer repair or require the network for that outcome', async () => {
		const snapshot = records({
			memberships: [{ ...membership, role: 'viewer', profileId: null }]
		})
		const f = integrityFixture(snapshot)
		const done = await waitFor(f.coordinator(), (s) => s.status === 'done')
		expect(done.output).toEqual({
			outcome: 'partial',
			settlement: 'notStarted',
			issues: ['profileLink']
		})
		expect(f.discover).toHaveBeenCalledTimes(3)
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('does not recreate access that remote discovery says has disappeared', async () => {
		const f = integrityFixture(brokenRecords(), records({ memberships: [] }))
		const done = await waitFor(f.coordinator(), (s) => s.status === 'done')
		expect(done.output).toEqual({
			outcome: 'unavailable',
			reason: 'accessUnavailable',
			settlement: 'notStarted'
		})
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('does not write if a concurrent remote role change removes repair authority', async () => {
		const remote = records({ memberships: [{ ...membership, role: 'viewer', profileId: null }] })
		const f = integrityFixture(brokenRecords(), remote)
		const done = await waitFor(f.coordinator(), (s) => s.status === 'done')
		expect(done.output).toEqual({
			outcome: 'partial',
			settlement: 'notStarted',
			issues: ['profileLink']
		})
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('surfaces remote read failure without writing or automatically retrying', async () => {
		const f = integrityFixture()
		const local = brokenRecords()
		const error = new Error('remote read failed')
		f.discover.mockReset().mockResolvedValue([])
		for (const rows of [local.profiles, local.organizations, local.memberships])
			f.discover.mockResolvedValueOnce(rows)
		f.discover.mockRejectedValueOnce(error)
		const done = await waitFor(f.coordinator(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'notStarted', error })
		expect(f.discover).toHaveBeenCalledTimes(6)
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('does not start a transaction from a late authoritative read after shutdown', async () => {
		const f = integrityFixture()
		const local = brokenRecords()
		const pending = Promise.withResolvers<ReturnType<typeof records>['profiles']>()
		f.discover.mockReset().mockResolvedValue([])
		for (const rows of [local.profiles, local.organizations, local.memberships])
			f.discover.mockResolvedValueOnce(rows)
		f.discover.mockReturnValueOnce(pending.promise)
		const actor = f.coordinator()
		await waitFor(actor, (s) => s.matches('awaitingAuthority'))
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().output).toEqual({ outcome: 'closed', settlement: 'notStarted' })
		pending.resolve(local.profiles)
		await pending.promise
		await Promise.resolve()
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('forwards cancellation then shutdown and waits for the child settlement', async () => {
		const f = integrityFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => pending.promise)
		const actor = f.coordinator()
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalledTimes(1))
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().matches({ repairing: 'closing' })).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.rollback).not.toHaveBeenCalled()
		pending.resolve()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'locallyPersisted' })
	})
	it('cancels preparation without starting database reads', async () => {
		const f = integrityFixture()
		const actor = f.coordinator()
		actor.send({ type: 'CANCEL' })
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.discover).not.toHaveBeenCalled()
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('rejects malformed scope IDs before reading or writing', async () => {
		const f = integrityFixture()
		const actor = createActor(workspaceIntegrity, {
			input: { ...scope, userId: 'invalid', db: f.db }
		}).start()
		try {
			const done = await waitFor(actor, (s) => s.status === 'done')
			expect(done.output).toMatchObject({ outcome: 'failed', settlement: 'notStarted' })
			expect(f.discover).not.toHaveBeenCalled()
			expect(f.beginTransaction).not.toHaveBeenCalled()
		} finally {
			actor.stop()
		}
	})
})
