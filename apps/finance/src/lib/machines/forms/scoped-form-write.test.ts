import { describe, expect, it, vi } from 'vitest'
import { createScopedFormWriteMachine } from './scoped-form-write.js'
import { renameFixture } from '../workspaces/workspace-rename.fixture.js'
import { createActor, waitFor } from 'xstate'

describe('shared single-write operation', () => {
	it('supervises a failed readiness projection before any write', async () => {
		const f = renameFixture()
		const write = vi.fn(async () => undefined)
		const machine = createScopedFormWriteMachine({
			...f.options,
			observe: f.observe,
			write,
			settlement: 'locallyPersisted',
			classifyBlocked: () => 'unavailable',
			selectAvailability: () => {
				throw new Error('private projection details')
			}
		})
		const actor = createActor(machine, { input: f.input() }).start()
		try {
			const done = await waitFor(actor, (s) => s.status === 'done')
			expect(done.output).toEqual({
				outcome: 'failed',
				code: 'operationFailed',
				settlement: 'notStarted'
			})
			expect(write).not.toHaveBeenCalled()
		} finally {
			actor.stop()
		}
	})
	it('does not replace newer blocked facts with an earlier successful refresh', async () => {
		const f = renameFixture()
		const actor = f.operation()
		actor.send({
			type: 'OBSERVE',
			observation: { revision: 1, facts: f.setFacts({ membershipLoading: true }) }
		})
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({
			outcome: 'unavailable',
			reason: 'loading',
			settlement: 'notStarted'
		})
		expect(f.issueRename).not.toHaveBeenCalled()
	})

	it('refreshes scope before writing and clears terminal request facts', async () => {
		const f = renameFixture()
		const input = f.input()
		f.setFacts({ organizationId: 'other' })
		const actor = createActor(f.options.operation, { input }).start()
		try {
			const done = await waitFor(actor, (s) => s.status === 'done')
			expect(done.output).toEqual({ outcome: 'scopeChanged', settlement: 'notStarted' })
			expect(done.context).toMatchObject({
				request: undefined,
				observation: undefined,
				capability: undefined
			})
			expect(f.issueRename).not.toHaveBeenCalled()
		} finally {
			actor.stop()
		}
	})
	it.each(['CANCEL', 'INVALIDATE', 'SHUTDOWN'] satisfies ('CANCEL' | 'INVALIDATE' | 'SHUTDOWN')[])(
		'honors %s before effect issue',
		async (type) => {
			const f = renameFixture()
			const actor = f.operation()
			actor.send({ type })
			const done = await waitFor(actor, (s) => s.status === 'done')
			expect(done.output).toEqual({
				outcome:
					type === 'CANCEL' ? 'cancelled' : type === 'INVALIDATE' ? 'scopeChanged' : 'closed',
				settlement: 'notStarted'
			})
			expect(f.issueRename).not.toHaveBeenCalled()
		}
	)
	it('supervises observation read failures before writing', async () => {
		const f = renameFixture()
		f.observe.mockImplementation(() => {
			throw new Error('private details')
		})
		const done = await waitFor(f.operation(), (s) => s.status === 'done')
		expect(done.output).toEqual({
			outcome: 'failed',
			code: 'operationFailed',
			settlement: 'notStarted'
		})
		expect(f.issueRename).not.toHaveBeenCalled()
	})
	it('preserves unavailable readiness separately from denial', async () => {
		const f = renameFixture()
		f.setFacts({ workspaceLoading: true })
		const done = await waitFor(f.operation(), (s) => s.status === 'done')
		expect(done.value).toBe('unavailable')
		expect(done.output).toEqual({
			outcome: 'unavailable',
			reason: 'loading',
			settlement: 'notStarted'
		})
		expect(f.issueRename).not.toHaveBeenCalled()
	})
	it.each([
		{ command: 'CANCEL', outcome: 'cancelled' },
		{ command: 'INVALIDATE', outcome: 'scopeChanged' },
		{ command: 'SHUTDOWN', outcome: 'closed' }
	] satisfies { command: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN'; outcome: string }[])(
		'awaits an issued write after $command and reports actual persistence',
		async ({ command, outcome }) => {
			const f = renameFixture()
			const actor = f.operation()
			await vi.waitFor(() => expect(f.persistLocal).toHaveBeenCalledTimes(1))
			actor.send({ type: command })
			expect(actor.getSnapshot().status).toBe('active')
			expect(f.issueRename).toHaveBeenCalledTimes(1)
			f.saved.resolve(undefined)
			const done = await waitFor(actor, (s) => s.status === 'done')
			expect(done.output).toEqual({ outcome, settlement: 'locallyPersisted' })
			expect(done.context.request).toBeUndefined()
		}
	)
	it.each(['pending', 'cancelled', 'invalidated', 'closed'])(
		'reports uncertain write rejection while %s without claiming rollback',
		async (phase) => {
			const f = renameFixture()
			const actor = f.operation()
			await vi.waitFor(() => expect(f.persistLocal).toHaveBeenCalledTimes(1))
			if (phase === 'cancelled') actor.send({ type: 'CANCEL' })
			if (phase === 'invalidated') actor.send({ type: 'INVALIDATE' })
			if (phase === 'closed') actor.send({ type: 'SHUTDOWN' })
			f.saved.reject(new Error('private provider details'))
			const done = await waitFor(actor, (s) => s.status === 'done')
			expect(done.output).toEqual(
				phase === 'pending'
					? { outcome: 'failed', code: 'operationFailed', settlement: 'unknown' }
					: { outcome: phase === 'invalidated' ? 'scopeChanged' : phase, settlement: 'unknown' }
			)
		}
	)
	it('keeps shutdown above queued cancellation, invalidation, scope updates and successful completion', async () => {
		const f = renameFixture()
		const actor = f.operation()
		await vi.waitFor(() => expect(f.persistLocal).toHaveBeenCalledTimes(1))
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'INVALIDATE' })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'INVALIDATE' })
		actor.send({
			type: 'OBSERVE',
			observation: { revision: 1, facts: f.setFacts({ identityId: 'other' }) }
		})
		f.saved.resolve(undefined)
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'locallyPersisted' })
	})
	it('invalidates scope replacements during an issued write without starting another one', async () => {
		const f = renameFixture()
		const actor = f.operation()
		await vi.waitFor(() => expect(f.persistLocal).toHaveBeenCalledTimes(1))
		actor.send({
			type: 'OBSERVE',
			observation: { revision: 1, facts: f.setFacts({ binding: {} }) }
		})
		actor.send({ type: 'CANCEL' })
		f.saved.resolve(undefined)
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'scopeChanged', settlement: 'locallyPersisted' })
		expect(f.issueRename).toHaveBeenCalledTimes(1)
	})
})
